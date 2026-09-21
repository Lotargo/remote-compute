import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { resolveClientExecutable } from './client_cli.mjs';
import { authenticateColab, checkColabAccess, getColabExecutable, installColabCli } from './colab.mjs';
import {
  HOST_DEFINITIONS,
  detectHosts,
  requestedHostIds,
  resolveSkillTargets,
  selectDetectedHosts,
  selectKnownHosts,
} from './hosts.mjs';
import { inspectSkillDir, installSkillTargets, removeSkillTargets } from './skills.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGED_SKILL_DIR = join(PACKAGE_ROOT, 'skills', 'remote-compute');

function printHelp() {
  console.log(`remote-compute

Usage:
  remote-compute setup [host flags] [--install-colab] [--yes] [--force]
  remote-compute doctor [host flags]
  remote-compute auth
  remote-compute uninstall [host flags] [--dry-run]
  remote-compute help

Host flags:
  --codex       Target Codex only
  --agy         Target AGY / Antigravity only
  --opencode    Target OpenCode only
  --claude      Target Claude Code only
  (no flag)     Setup/doctor detected hosts; uninstall checks all known host paths

Setup options:
  --install-colab  Install the official google-colab-cli if it is missing
  --yes            Non-interactive mode; does not imply --install-colab
  --force          Refresh a managed skill that differs from the packaged copy

Uninstall options:
  --dry-run        Preview owned skill directories that would be removed

Commands:
  setup       Detect agent hosts, install the remote-compute skill, and check Colab
  doctor      Validate host integration, skill ownership, provider CLI, and auth
  auth        Run Google's official ADC browser flow and verify Colab access
  uninstall   Remove only unmodified skill directories owned by remote-compute
`);
}

function printHosts(hosts, { requested = new Set() } = {}) {
  console.log('Agent hosts');
  for (const host of hosts) {
    const selected = requested.size === 0 || requested.has(host.id);
    const marker = host.path ? '✓' : '·';
    const suffix = host.path ? `  ${host.path}` : selected && requested.size > 0 ? '  requested but not found' : '';
    console.log(`${marker} ${host.label}${suffix}`);
  }
}

async function askYesNo(question, defaultYes = true) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultYes ? '[Y/n]' : '[y/N]';
    const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function missingRequestedHosts(hosts, args) {
  const requested = requestedHostIds(args);
  if (requested.size === 0) return [];
  return hosts.filter((host) => requested.has(host.id) && !host.path);
}

async function setup(args) {
  const yes = args.includes('--yes');
  const force = args.includes('--force');
  const installRequested = args.includes('--install-colab');
  const requested = requestedHostIds(args);

  console.log('remote-compute setup\n');

  const hosts = detectHosts();
  printHosts(hosts, { requested });

  for (const host of missingRequestedHosts(hosts, args)) {
    console.warn(`! ${host.label} was explicitly requested but its CLI is not available on PATH.`);
  }

  const activeHosts = selectDetectedHosts(hosts, args);
  if (activeHosts.length === 0) {
    console.error('\nNo selected supported agent CLI was found on PATH. Install at least one of: codex, agy, opencode, claude.');
    process.exitCode = 2;
    return;
  }

  console.log('\nSkills');
  const targets = resolveSkillTargets(activeHosts);
  await installSkillTargets(targets, PACKAGED_SKILL_DIR, { force });

  if (process.platform === 'win32') {
    console.warn('\n! Native Windows detected. The upstream Colab CLI currently requires Linux or macOS; use remote-compute from WSL.');
  }

  let colab = getColabExecutable();
  if (!colab) {
    console.warn('\n! Google Colab CLI is not installed or is not visible on PATH.');
    let shouldInstall = installRequested;
    if (!yes && !installRequested && process.platform !== 'win32') {
      shouldInstall = await askYesNo('Install the official google-colab-cli now?');
    }

    if (shouldInstall && process.platform !== 'win32') {
      const installed = installColabCli();
      colab = installed.executable;
    }
  }

  if (colab) {
    console.log(`\n✓ Colab CLI: ${colab}`);
    const access = checkColabAccess();
    if (access.ok) {
      console.log('✓ Colab authentication/access check passed.');
    } else {
      console.log(`· Colab access is not ready yet${access.detail ? `: ${access.detail}` : '.'}`);
      console.log('  Run: remote-compute auth');
    }
  } else if (process.platform !== 'win32') {
    console.log('\nNext step: install the official Colab CLI, then run `remote-compute auth`.');
  }

  console.log('\nSetup complete. Restart/reload your agent CLI if it does not notice the new skill immediately.');
}

async function doctor(args) {
  console.log('remote-compute doctor\n');

  const checks = [];
  const record = (level, label, detail = '') => {
    checks.push({ level, label, detail });
    console.log(`[${level}] ${label}${detail ? `: ${detail}` : ''}`);
  };

  const requested = requestedHostIds(args);
  const hosts = detectHosts();
  printHosts(hosts, { requested });
  console.log('');

  for (const host of missingRequestedHosts(hosts, args)) {
    record('FAIL', `${host.label} CLI`, 'explicitly requested but not found on PATH');
  }

  const activeHosts = selectDetectedHosts(hosts, args);
  if (activeHosts.length === 0) {
    record('FAIL', 'Agent host', 'no selected supported agent CLI found');
  } else {
    record('OK', 'Agent host discovery', `${activeHosts.length} selected host(s)`);
  }

  console.log('\nSkills');
  const targets = resolveSkillTargets(activeHosts);
  for (const target of targets) {
    const state = await inspectSkillDir(target.dir, PACKAGED_SKILL_DIR);
    if (state.owned) {
      record('OK', 'Skill', target.label);
    } else if (state.exists && state.managed) {
      record('WARN', 'Skill', `${target.label} differs from packaged copy (possibly customized or stale)`);
    } else if (state.exists) {
      record('FAIL', 'Skill', `${target.label} is occupied by an unrelated skill`);
    } else {
      record('FAIL', 'Skill', `${target.label} is missing`);
    }
  }

  console.log('\nProvider: Google Colab');
  const colab = getColabExecutable();
  if (!colab) {
    record('FAIL', 'Colab CLI', 'not found on PATH');
  } else {
    record('OK', 'Colab CLI', colab);
    const access = checkColabAccess();
    if (access.ok) record('OK', 'Colab authentication/access', 'read-only sessions query succeeded');
    else record('FAIL', 'Colab authentication/access', access.detail || 'run `remote-compute auth`');
  }

  const gcloud = resolveClientExecutable('gcloud');
  if (gcloud) record('INFO', 'gcloud', gcloud);
  else record('INFO', 'gcloud', 'not installed; only needed for the recommended auth flow');

  if (process.platform === 'win32') {
    record('FAIL', 'Platform', 'native Windows; use WSL for the upstream Colab CLI');
  } else {
    record('OK', 'Platform', process.platform);
  }

  const failures = checks.filter((check) => check.level === 'FAIL').length;
  const warnings = checks.filter((check) => check.level === 'WARN').length;
  const status = failures > 0 ? 'NEEDS ATTENTION' : warnings > 0 ? 'READY WITH WARNINGS' : 'READY';
  console.log(`\nStatus: ${status}`);
  if (failures > 0) process.exitCode = 1;
}

async function auth() {
  const result = authenticateColab();

  if (result.ok) {
    console.log(result.alreadyAuthenticated
      ? '✓ Colab authentication already works.'
      : '✓ Colab authentication verified.');
    return;
  }

  switch (result.reason) {
    case 'missing_colab':
      console.error('Google Colab CLI is missing. Install it first with `uv tool install google-colab-cli`.');
      process.exitCode = 2;
      break;
    case 'missing_gcloud':
      console.error('`gcloud` is required for the recommended ADC authentication flow but was not found on PATH.');
      console.error('Install Google Cloud CLI, then rerun `remote-compute auth`.');
      console.error('remote-compute never stores Google credentials itself.');
      process.exitCode = 2;
      break;
    case 'gcloud_auth_failed':
      console.error(`Google authentication did not complete successfully${result.detail ? `: ${result.detail}` : '.'}`);
      process.exitCode = 1;
      break;
    case 'verification_failed':
      console.error(`Authentication finished, but Colab verification still failed${result.detail ? `: ${result.detail}` : '.'}`);
      console.error('Run `colab skill` / `colab help` for upstream diagnostics.');
      process.exitCode = 1;
      break;
    default:
      console.error(`Colab authentication failed${result.detail ? `: ${result.detail}` : '.'}`);
      process.exitCode = 1;
  }
}

async function uninstall(args) {
  const dryRun = args.includes('--dry-run') || args.includes('--dry');
  console.log(`remote-compute uninstall${dryRun ? ' (dry run)' : ''}\n`);

  const knownHosts = selectKnownHosts(args);
  const targets = resolveSkillTargets(knownHosts);
  const results = await removeSkillTargets(targets, PACKAGED_SKILL_DIR, { dryRun });

  const removable = results.filter((result) => result.status === 'removed' || result.status === 'would_remove').length;
  const protectedCount = results.filter((result) => result.status === 'modified' || result.status === 'conflict').length;

  console.log(`\n${dryRun ? 'Preview' : 'Uninstall'} complete. ${removable} owned skill target(s) ${dryRun ? 'would be removed' : 'removed'}, ${protectedCount} protected.`);
  console.log('Provider CLIs and Google credentials were left untouched.');
}

export async function main(argv) {
  const command = argv[0] || 'help';
  const args = argv.slice(1);

  switch (command) {
    case 'setup':
      await setup(args);
      break;
    case 'doctor':
      await doctor(args);
      break;
    case 'auth':
      await auth();
      break;
    case 'uninstall':
      await uninstall(args);
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    case '--version':
    case '-v': {
      const pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
      console.log(pkg.version);
      break;
    }
    default:
      console.error(`Unknown command: ${command}\n`);
      printHelp();
      process.exitCode = 2;
  }
}

export { HOST_DEFINITIONS };

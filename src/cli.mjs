import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import {
  authenticateColab,
  checkColabAccess,
  forwardColab,
  installColabCli,
  resolveColabRuntime,
} from './colab.mjs';
import {
  HOST_DEFINITIONS,
  detectHosts,
  requestedHostIds,
  resolveSkillTargets,
  selectDetectedHosts,
  selectKnownHosts,
} from './hosts.mjs';
import { inspectSkillDir, installSkillTargets, removeSkillTargets } from './skills.mjs';
import { createWslTransport, installWsl, inspectWsl, windowsPathToWsl } from './transports/wsl.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGED_SKILL_DIR = join(PACKAGE_ROOT, 'skills', 'remote-compute');

function printHelp() {
  console.log(`remote-compute

Usage:
  remote-compute setup [host flags] [--install-colab] [--install-wsl] [--wsl-distro <name>] [--yes] [--force]
  remote-compute doctor [host flags] [--wsl-distro <name>]
  remote-compute auth [--wsl-distro <name>]
  remote-compute colab <provider args...>
  remote-compute wsl-path <absolute Windows path> [--wsl-distro <name>]
  remote-compute uninstall [host flags] [--dry-run]
  remote-compute help

Host flags:
  --codex       Target Codex only
  --agy         Target AGY / Antigravity only
  --opencode    Target OpenCode only
  --claude      Target Claude Code only
  (no flag)     Setup/doctor detected hosts; uninstall checks all known host paths

Setup options:
  --install-colab       Install the official google-colab-cli if it is missing
  --install-wsl         On Windows, install WSL + the selected distro when missing
  --wsl-distro <name>   Use a specific installed WSL distro (default: Windows WSL default)
  --yes                 Non-interactive mode; does not imply installation flags
  --force               Refresh a managed skill that differs from the packaged copy

Uninstall options:
  --dry-run             Preview owned skill directories that would be removed

Commands:
  setup       Detect agent hosts, install the skill, and prepare the provider transport
  doctor      Validate host integration, provider transport, Colab CLI, and auth
  auth        Run Google's official ADC flow through the selected provider transport
  colab       Transparent passthrough to the official Colab CLI (native or WSL)
  wsl-path    Ask WSL/wslpath to translate an absolute Windows path; no drive letters are hardcoded
  uninstall   Remove only unmodified skill directories owned by remote-compute
`);
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return null;
  const value = args[index + 1];
  if (String(value).startsWith('--')) return null;
  return value;
}

function providerEnvForArgs(args) {
  const distro = flagValue(args, '--wsl-distro');
  if (!distro) return process.env;
  return { ...process.env, REMOTE_COMPUTE_WSL_DISTRO: distro };
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

function wslSetupDetail(reason) {
  switch (reason) {
    case 'missing_wsl':
      return 'wsl.exe was not found on PATH';
    case 'wsl_unavailable':
      return 'WSL exists but is not ready';
    case 'no_distribution':
      return 'WSL has no installed Linux distribution';
    case 'requested_distribution_missing':
      return 'the requested WSL distribution is not installed';
    default:
      return reason || 'WSL is not ready';
  }
}

async function ensureWindowsTransport(args, env) {
  if (process.platform !== 'win32') return { ok: true, changed: false };

  const runtime = resolveColabRuntime({ env });
  if (runtime.ok || runtime.reason === 'missing_colab_wsl') {
    return { ok: true, changed: false, runtime };
  }

  const installRequested = args.includes('--install-wsl');
  const yes = args.includes('--yes');
  let shouldInstall = installRequested;
  if (!yes && !installRequested) {
    shouldInstall = await askYesNo(
      `Windows needs WSL as the Colab compatibility backend (${wslSetupDetail(runtime.reason)}). Install WSL now?`,
      false,
    );
  }

  if (!shouldInstall) {
    return { ok: false, changed: false, reason: runtime.reason, runtime };
  }

  const distro = flagValue(args, '--wsl-distro') || 'Ubuntu';
  const installed = installWsl({ env, distro });
  if (!installed.ok) {
    console.error(`! WSL installation failed${installed.detail ? `: ${installed.detail}` : `: ${installed.reason}`}`);
    return { ok: false, changed: false, reason: installed.reason };
  }

  console.log(`✓ WSL installation requested for ${distro}.`);
  console.log('  Windows may require a restart, and a newly installed distro may require one-time user initialization.');
  console.log('  After that, rerun `remote-compute setup --install-colab`.');
  return { ok: false, changed: true, reason: 'wsl_install_requested' };
}

async function setup(args) {
  const yes = args.includes('--yes');
  const force = args.includes('--force');
  const installRequested = args.includes('--install-colab');
  const requested = requestedHostIds(args);
  const providerEnv = providerEnvForArgs(args);

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
    console.log('\nProvider transport');
    const prepared = await ensureWindowsTransport(args, providerEnv);
    if (!prepared.ok && prepared.changed) return;
    if (!prepared.ok) {
      console.warn(`! WSL transport is not ready: ${wslSetupDetail(prepared.reason)}.`);
      console.warn('  Run `remote-compute setup --install-wsl`, or install/initialize WSL manually.');
    }
  }

  let runtime = resolveColabRuntime({ env: providerEnv });
  if (!runtime.ok) {
    const readyForInstall = runtime.reason === 'missing_colab' || runtime.reason === 'missing_colab_wsl';
    if (readyForInstall) {
      console.warn(`\n! Google Colab CLI is not installed in the selected ${runtime.mode || 'provider'} environment.`);
      let shouldInstall = installRequested;
      if (!yes && !installRequested) {
        shouldInstall = await askYesNo('Install the official google-colab-cli now?');
      }

      if (shouldInstall) {
        const installed = installColabCli({ env: providerEnv });
        if (installed.ok) runtime = resolveColabRuntime({ env: providerEnv });
      }
    }
  }

  if (runtime.ok) {
    console.log(`\n✓ Provider transport: ${runtime.transport.label}`);
    console.log(`✓ Colab CLI: ${runtime.executable}`);
    const access = checkColabAccess({ env: providerEnv });
    if (access.ok) {
      console.log('✓ Colab authentication/access check passed.');
    } else {
      console.log(`· Colab access is not ready yet${access.detail ? `: ${access.detail}` : '.'}`);
      console.log('  Run: remote-compute auth');
    }
  } else if (runtime.reason !== 'missing_wsl' && runtime.reason !== 'wsl_unavailable' && runtime.reason !== 'no_distribution') {
    console.log('\nNext step: prepare the provider environment, then run `remote-compute auth`.');
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
  const providerEnv = providerEnvForArgs(args);
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
  const runtime = resolveColabRuntime({ env: providerEnv });

  if (process.platform === 'win32' && runtime.mode === 'wsl') {
    const wsl = inspectWsl({ env: providerEnv });
    if (wsl.ok) {
      record('OK', 'WSL', wsl.executable);
      record('OK', 'WSL distribution', wsl.distro || 'Windows default distribution');
    } else {
      record('FAIL', 'WSL transport', wslSetupDetail(wsl.reason));
      if (wsl.requestedDistribution) {
        record('INFO', 'Requested WSL distribution', wsl.requestedDistribution);
      }
    }
  }

  if (!runtime.ok) {
    if (runtime.reason === 'missing_colab_wsl' && runtime.transport) {
      record('OK', 'Provider transport', runtime.transport.label);
      record('FAIL', 'Colab CLI', 'not installed inside WSL; run `remote-compute setup --install-colab`');
    } else if (runtime.reason === 'missing_colab') {
      record('FAIL', 'Colab CLI', 'not found on PATH');
    } else if (runtime.reason !== 'missing_colab_wsl') {
      record('FAIL', 'Provider transport', wslSetupDetail(runtime.reason));
    }
  } else {
    record('OK', 'Provider transport', runtime.transport.label);
    record('OK', 'Colab CLI', runtime.executable);
    const access = checkColabAccess({ env: providerEnv });
    if (access.ok) record('OK', 'Colab authentication/access', 'read-only sessions query succeeded');
    else record('FAIL', 'Colab authentication/access', access.detail || 'run `remote-compute auth`');
  }

  const providerTransport = runtime.transport
    || (process.platform === 'win32' ? createWslTransport({ env: providerEnv }).transport : null);
  if (providerTransport) {
    const gcloud = providerTransport.resolve('gcloud');
    if (gcloud) record('INFO', 'gcloud', `${providerTransport.label}: ${gcloud}`);
    else record('INFO', 'gcloud', `not installed in ${providerTransport.label}; needed for the recommended auth flow`);
  } else {
    record('INFO', 'gcloud', 'provider transport unavailable');
  }

  record('OK', 'Platform', process.platform === 'win32' ? 'win32 (WSL bridge supported)' : process.platform);

  const failures = checks.filter((check) => check.level === 'FAIL').length;
  const warnings = checks.filter((check) => check.level === 'WARN').length;
  const status = failures > 0 ? 'NEEDS ATTENTION' : warnings > 0 ? 'READY WITH WARNINGS' : 'READY';
  console.log(`\nStatus: ${status}`);
  if (failures > 0) process.exitCode = 1;
}

async function auth(args) {
  const providerEnv = providerEnvForArgs(args);
  const result = authenticateColab({ env: providerEnv });

  if (result.ok) {
    console.log(result.alreadyAuthenticated
      ? `✓ Colab authentication already works via ${result.runtime.transport.label}.`
      : `✓ Colab authentication verified via ${result.runtime.transport.label}.`);
    return;
  }

  switch (result.reason) {
    case 'missing_colab':
      console.error('Google Colab CLI is missing in the selected provider environment. Run `remote-compute setup --install-colab`.');
      process.exitCode = 2;
      break;
    case 'missing_wsl':
    case 'wsl_unavailable':
    case 'no_distribution':
    case 'requested_distribution_missing':
      console.error(`WSL provider transport is not ready: ${wslSetupDetail(result.reason)}.`);
      console.error('Run `remote-compute setup --install-wsl --install-colab`.');
      process.exitCode = 2;
      break;
    case 'missing_gcloud':
      console.error('`gcloud` is required in the same environment as the Colab CLI for the recommended ADC flow.');
      console.error('Install Google Cloud CLI there, then rerun `remote-compute auth`.');
      console.error('remote-compute never stores Google credentials itself.');
      process.exitCode = 2;
      break;
    case 'gcloud_auth_failed':
      console.error(`Google authentication did not complete successfully${result.detail ? `: ${result.detail}` : '.'}`);
      process.exitCode = 1;
      break;
    case 'verification_failed':
      console.error(`Authentication finished, but Colab verification still failed${result.detail ? `: ${result.detail}` : '.'}`);
      console.error('Run `remote-compute colab skill` / `remote-compute colab help` for upstream diagnostics.');
      process.exitCode = 1;
      break;
    default:
      console.error(`Colab authentication failed${result.detail ? `: ${result.detail}` : '.'}`);
      process.exitCode = 1;
  }
}

function providerArgs(args) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--wsl-distro') {
      index += 1;
      continue;
    }
    result.push(args[index]);
  }
  return result;
}

function colab(args) {
  const providerEnv = providerEnvForArgs(args);
  const forwarded = forwardColab(providerArgs(args), { env: providerEnv });
  if (forwarded.ok) return;

  if (forwarded.reason === 'missing_colab_wsl' || forwarded.reason === 'missing_colab') {
    console.error('Colab CLI is not installed in the selected provider environment. Run `remote-compute setup --install-colab`.');
  } else if (['missing_wsl', 'wsl_unavailable', 'no_distribution', 'requested_distribution_missing'].includes(forwarded.reason)) {
    console.error(`WSL provider transport is not ready: ${wslSetupDetail(forwarded.reason)}.`);
  } else {
    console.error(`Colab command failed${forwarded.detail ? `: ${forwarded.detail}` : '.'}`);
  }
  process.exitCode = forwarded.status || 1;
}

function wslPath(args) {
  const path = args.find((arg, index) => arg !== '--wsl-distro' && args[index - 1] !== '--wsl-distro');
  if (!path) {
    console.error('Usage: remote-compute wsl-path <absolute Windows path> [--wsl-distro <name>]');
    process.exitCode = 2;
    return;
  }

  const env = providerEnvForArgs(args);
  const translated = windowsPathToWsl(path, { env });
  if (!translated.ok) {
    console.error(`Unable to translate path: ${translated.detail || translated.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(translated.path);
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
  console.log('Provider CLIs, WSL distributions, and Google credentials were left untouched.');
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
      await auth(args);
      break;
    case 'colab':
      colab(args);
      break;
    case 'wsl-path':
      wslPath(args);
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

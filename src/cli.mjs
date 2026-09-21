import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_SOURCE = join(PACKAGE_ROOT, 'skills', 'remote-compute', 'SKILL.md');
const MANAGED_MARKER = 'managed-by: remote-compute';

const HOSTS = [
  { id: 'codex', command: 'codex', family: 'agents', label: 'Codex' },
  { id: 'agy', command: 'agy', family: 'agents', label: 'AGY / Antigravity CLI' },
  { id: 'opencode', command: 'opencode', family: 'agents', label: 'OpenCode' },
  { id: 'claude', command: 'claude', family: 'claude', label: 'Claude Code' },
];

const COLAB_INSTALL = {
  uv: ['tool', 'install', 'google-colab-cli'],
  python3: ['-m', 'pip', 'install', '--user', 'google-colab-cli'],
  python: ['-m', 'pip', 'install', '--user', 'google-colab-cli'],
};

const COLAB_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/colaboratory',
].join(',');

function printHelp() {
  console.log(`remote-compute

Usage:
  remote-compute setup [--install-colab] [--yes] [--force]
  remote-compute doctor
  remote-compute auth
  remote-compute uninstall
  remote-compute help

Commands:
  setup       Detect agent hosts and install the remote-compute skill.
  doctor      Check agent hosts, skill installation, Colab CLI and auth.
  auth        Run Google's ADC browser authentication flow and verify Colab.
  uninstall   Remove only skill files managed by remote-compute.

Options:
  --install-colab  Install google-colab-cli if it is missing.
  --yes            Non-interactive mode. Does not imply --install-colab.
  --force          Rewrite managed skill copies even if already installed.
`);
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pathCandidates(command) {
  const paths = (process.env.PATH || '').split(delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];

  const candidates = [];
  for (const base of paths) {
    for (const ext of extensions) {
      candidates.push(join(base, process.platform === 'win32' ? `${command}${ext}` : command));
    }
  }
  return candidates;
}

function findExecutable(command) {
  for (const candidate of pathCandidates(command)) {
    try {
      const result = spawnSync(candidate, ['--version'], {
        stdio: 'ignore',
        timeout: 3000,
      });
      if (!result.error || result.error.code !== 'ENOENT') return candidate;
    } catch {
      // Keep scanning PATH.
    }
  }
  return null;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: options.inherit ? undefined : 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    timeout: options.timeout ?? 120000,
    env: process.env,
  });
}

function detectHosts() {
  return HOSTS.map((host) => ({ ...host, path: findExecutable(host.command) }));
}

function skillTargets(hosts) {
  const home = homedir();
  const targets = [];

  if (hosts.some((host) => host.path && host.family === 'agents')) {
    targets.push({
      family: 'agents',
      path: join(home, '.agents', 'skills', 'remote-compute', 'SKILL.md'),
      label: '~/.agents/skills/remote-compute/SKILL.md',
    });
  }

  if (hosts.some((host) => host.path && host.family === 'claude')) {
    targets.push({
      family: 'claude',
      path: join(home, '.claude', 'skills', 'remote-compute', 'SKILL.md'),
      label: '~/.claude/skills/remote-compute/SKILL.md',
    });
  }

  return targets;
}

async function inspectSkill(path) {
  if (!(await exists(path))) return { exists: false, managed: false };
  const content = await readFile(path, 'utf8');
  return { exists: true, managed: content.includes(MANAGED_MARKER), content };
}

async function installSkills(hosts, { force = false } = {}) {
  const source = await readFile(SKILL_SOURCE, 'utf8');
  const targets = skillTargets(hosts);

  for (const target of targets) {
    const state = await inspectSkill(target.path);
    if (state.exists && !state.managed) {
      console.warn(`! ${target.label} already exists and is not managed by remote-compute; leaving it untouched.`);
      continue;
    }

    if (state.exists && state.content === source && !force) {
      console.log(`✓ skill already current: ${target.label}`);
      continue;
    }

    await mkdir(dirname(target.path), { recursive: true });
    await writeFile(target.path, source, 'utf8');
    console.log(`✓ installed skill: ${target.label}`);
  }
}

async function removeManagedSkill(path, label) {
  const state = await inspectSkill(path);
  if (!state.exists) {
    console.log(`· not installed: ${label}`);
    return;
  }
  if (!state.managed) {
    console.warn(`! not removing unmanaged skill: ${label}`);
    return;
  }
  await rm(dirname(path), { recursive: true, force: true });
  console.log(`✓ removed: ${label}`);
}

function printHosts(hosts) {
  console.log('Agent hosts');
  for (const host of hosts) {
    console.log(`${host.path ? '✓' : '·'} ${host.label}${host.path ? `  ${host.path}` : ''}`);
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

function installColab() {
  for (const command of ['uv', 'python3', 'python']) {
    const executable = findExecutable(command);
    if (!executable) continue;

    console.log(`Installing google-colab-cli with ${command}...`);
    const result = run(executable, COLAB_INSTALL[command], { inherit: true, timeout: 300000 });
    if (result.status === 0) {
      const colab = findExecutable('colab');
      if (colab) {
        console.log(`✓ Colab CLI installed: ${colab}`);
        return colab;
      }
      console.warn('! Installation completed, but `colab` is not visible on PATH in this process yet.');
      return null;
    }
  }

  console.error('Could not install google-colab-cli automatically. Install `uv` or Python first, then run:');
  console.error('  uv tool install google-colab-cli');
  return null;
}

function checkColabAuth() {
  const colab = findExecutable('colab');
  if (!colab) return { ok: false, reason: 'missing' };

  const result = run(colab, ['sessions'], { timeout: 30000 });
  if (result.status === 0) return { ok: true };

  const detail = `${result.stderr || ''}${result.stdout || ''}`.trim();
  return { ok: false, reason: 'auth', detail };
}

async function setup(args) {
  const yes = args.includes('--yes');
  const force = args.includes('--force');
  const installRequested = args.includes('--install-colab');

  console.log('remote-compute setup\n');

  const hosts = detectHosts();
  printHosts(hosts);
  const activeHosts = hosts.filter((host) => host.path);

  if (activeHosts.length === 0) {
    console.error('\nNo supported agent CLI found on PATH. Install at least one of: codex, agy, opencode, claude.');
    process.exitCode = 2;
    return;
  }

  console.log('');
  await installSkills(hosts, { force });

  let colab = findExecutable('colab');
  if (!colab) {
    console.warn('\n! Google Colab CLI is not installed.');
    let shouldInstall = installRequested;
    if (!yes && !installRequested) {
      shouldInstall = await askYesNo('Install the official google-colab-cli now?');
    }
    if (shouldInstall) colab = installColab();
  }

  if (colab) {
    console.log(`\n✓ Colab CLI: ${colab}`);
    const auth = checkColabAuth();
    if (auth.ok) {
      console.log('✓ Colab authentication check passed.');
    } else {
      console.log('· Colab authentication is not ready yet. Run: remote-compute auth');
    }
  } else {
    console.log('\nNext step: install the official Colab CLI, then run `remote-compute auth`.');
  }

  if (process.platform === 'win32') {
    console.warn('\n! Upstream Colab CLI does not currently support native Windows. Run remote-compute from WSL.');
  }

  console.log('\nSetup complete. Restart/reload your agent CLI if it does not notice the new skill immediately.');
}

async function doctor() {
  console.log('remote-compute doctor\n');
  const hosts = detectHosts();
  printHosts(hosts);

  const activeHosts = hosts.filter((host) => host.path);
  let hardFailure = activeHosts.length === 0;

  console.log('\nSkills');
  const targets = skillTargets(hosts);
  if (targets.length === 0) {
    console.log('✗ no skill target because no supported host was detected');
  }
  for (const target of targets) {
    const state = await inspectSkill(target.path);
    const ok = state.exists && state.managed;
    console.log(`${ok ? '✓' : '✗'} ${target.label}${state.exists && !state.managed ? ' (occupied by unmanaged skill)' : ''}`);
    if (!ok) hardFailure = true;
  }

  console.log('\nProvider: Google Colab');
  const colab = findExecutable('colab');
  console.log(`${colab ? '✓' : '✗'} colab CLI${colab ? `  ${colab}` : ''}`);
  if (!colab) hardFailure = true;

  const gcloud = findExecutable('gcloud');
  console.log(`${gcloud ? '✓' : '·'} gcloud${gcloud ? `  ${gcloud}` : '  optional until authentication is needed'}`);

  if (colab) {
    const auth = checkColabAuth();
    console.log(`${auth.ok ? '✓' : '·'} Colab authentication${auth.ok ? '' : '  run `remote-compute auth` if needed'}`);
  }

  if (process.platform === 'win32') {
    console.log('\n✗ native Windows detected; upstream Colab CLI currently requires Linux or macOS. Use WSL.');
    hardFailure = true;
  } else {
    console.log(`\n✓ platform: ${process.platform}`);
  }

  console.log(`\nStatus: ${hardFailure ? 'NEEDS ATTENTION' : 'READY'}`);
  if (hardFailure) process.exitCode = 1;
}

async function auth() {
  const colab = findExecutable('colab');
  if (!colab) {
    console.error('Google Colab CLI is missing. Install it first with `uv tool install google-colab-cli`.');
    process.exitCode = 2;
    return;
  }

  const existing = checkColabAuth();
  if (existing.ok) {
    console.log('✓ Colab authentication already works.');
    return;
  }

  const gcloud = findExecutable('gcloud');
  if (!gcloud) {
    console.error('`gcloud` is required for the recommended ADC authentication flow but was not found on PATH.');
    console.error('Install Google Cloud CLI, then rerun `remote-compute auth`.');
    console.error('remote-compute never stores Google credentials itself.');
    process.exitCode = 2;
    return;
  }

  console.log('Opening the official Google Application Default Credentials flow...');
  const result = run(gcloud, [
    'auth',
    'application-default',
    'login',
    `--scopes=${COLAB_SCOPES}`,
  ], { inherit: true, timeout: 300000 });

  if (result.status !== 0) {
    console.error('Google authentication did not complete successfully.');
    process.exitCode = result.status || 1;
    return;
  }

  const verified = checkColabAuth();
  if (verified.ok) {
    console.log('✓ Colab authentication verified.');
  } else {
    console.error('Authentication finished, but `colab sessions` still failed. Run `colab whoami` or `colab skill` for upstream diagnostics.');
    process.exitCode = 1;
  }
}

async function uninstall() {
  const home = homedir();
  console.log('remote-compute uninstall\n');
  await removeManagedSkill(
    join(home, '.agents', 'skills', 'remote-compute', 'SKILL.md'),
    '~/.agents/skills/remote-compute/SKILL.md',
  );
  await removeManagedSkill(
    join(home, '.claude', 'skills', 'remote-compute', 'SKILL.md'),
    '~/.claude/skills/remote-compute/SKILL.md',
  );
  console.log('\nProvider CLIs and credentials were left untouched.');
}

export async function main(argv) {
  const command = argv[0] || 'help';
  const args = argv.slice(1);

  switch (command) {
    case 'setup':
      await setup(args);
      break;
    case 'doctor':
      await doctor();
      break;
    case 'auth':
      await auth();
      break;
    case 'uninstall':
      await uninstall();
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

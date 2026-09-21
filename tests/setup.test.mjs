import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = join(ROOT, 'bin', 'remote-compute.mjs');

async function makeExecutable(binDir, name, body = null) {
  const isWindows = process.platform === 'win32';
  const path = join(binDir, isWindows ? `${name}.cmd` : name);
  const script = body || (isWindows
    ? '@echo off\r\nexit /b 0\r\n'
    : '#!/bin/sh\nexit 0\n');
  await writeFile(path, script, 'utf8');
  if (!isWindows) await chmod(path, 0o755);
  return path;
}

function runCli(args, { cwd, env }) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

export async function runSetupTests() {
  console.log('--- setup lifecycle ---');
  const root = await mkdtemp(join(tmpdir(), 'remote-compute-setup-'));
  const home = join(root, 'home');
  const cwd = join(root, 'workspace');
  const binDir = join(root, 'bin');

  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(cwd, { recursive: true }),
    mkdir(binDir, { recursive: true }),
  ]);

  try {
    await makeExecutable(binDir, 'codex');
    await makeExecutable(
      binDir,
      'colab',
      process.platform === 'win32'
        ? '@echo off\r\nexit /b 0\r\n'
        : '#!/bin/sh\nexit 0\n',
    );

    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PATH: `${binDir}${delimiter}${process.env.PATH || ''}`,
      PATHEXT: '.CMD;.EXE;.BAT;.COM',
    };

    const first = runCli(['setup', '--codex', '--yes'], { cwd, env });
    assert.equal(first.status, 0, first.stderr || first.stdout);

    const codexSkill = join(home, '.codex', 'skills', 'remote-compute', 'SKILL.md');
    const sharedSkill = join(home, '.agents', 'skills', 'remote-compute', 'SKILL.md');
    assert.equal(existsSync(codexSkill), true);
    assert.equal(existsSync(sharedSkill), true);

    const second = runCli(['setup', '--codex', '--yes'], { cwd, env });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.match(second.stdout, /skill already current/i);

    await writeFile(codexSkill, `${await readFile(codexSkill, 'utf8')}\nuser customization\n`, 'utf8');

    const preview = runCli(['uninstall', '--codex', '--dry-run'], { cwd, env });
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    assert.equal(existsSync(codexSkill), true);
    assert.equal(existsSync(sharedSkill), true);

    const uninstall = runCli(['uninstall', '--codex'], { cwd, env });
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
    assert.equal(existsSync(codexSkill), true, 'modified skill must be preserved');
    assert.equal(existsSync(sharedSkill), false, 'unmodified owned skill should be removed');
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

if (process.argv[1]?.endsWith('setup.test.mjs')) {
  runSetupTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

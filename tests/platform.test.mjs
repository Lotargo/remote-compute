import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { resolveClientExecutable } from '../src/client_cli.mjs';
import { resolveClientPaths } from '../src/client_paths.mjs';
import { resolveSkillTargets } from '../src/hosts.mjs';

export async function runPlatformTests() {
  console.log('--- platform contracts ---');
  const root = await mkdtemp(join(tmpdir(), 'remote-compute-platform-'));
  const home = join(root, 'home');
  const cwd = join(root, 'workspace');
  const binDir = join(root, 'bin');
  const xdgConfig = join(root, 'xdg', 'config');
  const customOpenCode = join(root, 'custom-opencode');

  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(join(cwd, '.agents'), { recursive: true }),
    mkdir(binDir, { recursive: true }),
  ]);

  try {
    const unixExecutable = join(binDir, 'probe-unix');
    await writeFile(unixExecutable, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(unixExecutable, 0o755);

    const windowsExecutable = join(binDir, 'probe-win.cmd');
    await writeFile(windowsExecutable, '@echo off\r\nexit /b 0\r\n', 'utf8');

    const baseEnv = {
      PATH: binDir,
      PATHEXT: '.CMD;.EXE;.BAT;.COM',
      XDG_CONFIG_HOME: xdgConfig,
      OPENCODE_CONFIG_DIR: customOpenCode,
    };

    assert.equal(
      resolveClientExecutable('probe-unix', { env: baseEnv, platform: 'linux' }),
      unixExecutable,
    );
    assert.equal(
      resolveClientExecutable('probe-win', { env: baseEnv, platform: 'win32' }),
      windowsExecutable,
    );
    assert.equal(
      resolveClientExecutable('missing', { env: baseEnv, platform: 'linux' }),
      null,
    );

    const disabledEnv = {
      ...baseEnv,
      REMOTE_COMPUTE_DISABLE_NATIVE_CLI: '1',
    };
    assert.equal(
      resolveClientExecutable('probe-unix', { env: disabledEnv, platform: 'linux' }),
      null,
    );

    const paths = resolveClientPaths({ home, cwd, env: baseEnv });
    assert.equal(paths.configHome, xdgConfig);
    assert.equal(paths.opencodeDir, customOpenCode);
    assert.equal(paths.opencodeSkillsDir, join(customOpenCode, 'skills'));
    assert.equal(paths.sharedAgentsSkillsDir, join(home, '.agents', 'skills'));
    assert.equal(paths.localAgentsSkillsDir, join(cwd, '.agents', 'skills'));

    const hosts = [
      { id: 'codex' },
      { id: 'agy' },
      { id: 'opencode' },
      { id: 'claude' },
    ];
    const targets = resolveSkillTargets(hosts, { home, cwd, env: baseEnv });
    const dirs = new Set(targets.map((target) => target.dir));

    for (const expected of [
      join(home, '.codex', 'skills', 'remote-compute'),
      join(home, '.agents', 'skills', 'remote-compute'),
      join(home, '.gemini', 'config', 'skills', 'remote-compute'),
      join(cwd, '.agents', 'skills', 'remote-compute'),
      join(customOpenCode, 'skills', 'remote-compute'),
      join(home, '.claude', 'skills', 'remote-compute'),
    ]) {
      assert.ok(dirs.has(expected), `missing skill target: ${expected}`);
    }

    const pathWithExisting = `${binDir}${delimiter}${process.env.PATH || ''}`;
    assert.ok(pathWithExisting.startsWith(binDir), 'PATH composition must preserve injected tool directory first');
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

if (process.argv[1]?.endsWith('platform.test.mjs')) {
  runPlatformTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

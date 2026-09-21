import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { detectHosts, resolveSkillTargets, selectDetectedHosts } from '../src/hosts.mjs';

async function makeExecutable(binDir, name) {
  const isWindows = process.platform === 'win32';
  const path = join(binDir, isWindows ? `${name}.cmd` : name);
  await writeFile(path, isWindows ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n', 'utf8');
  if (!isWindows) await chmod(path, 0o755);
  return path;
}

export async function runHostTests() {
  console.log('--- hosts ---');
  const root = await mkdtemp(join(tmpdir(), 'remote-compute-hosts-'));
  const home = join(root, 'home');
  const cwd = join(root, 'workspace');
  const binDir = join(root, 'bin');
  const customOpenCode = join(root, 'custom-opencode');

  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(join(cwd, '.agents'), { recursive: true }),
    mkdir(binDir, { recursive: true }),
  ]);

  try {
    const codexPath = await makeExecutable(binDir, 'codex');
    const agyPath = await makeExecutable(binDir, 'agy');
    const opencodePath = await makeExecutable(binDir, 'opencode');

    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PATH: `${binDir}${delimiter}${process.env.PATH || ''}`,
      PATHEXT: '.CMD;.EXE;.BAT;.COM',
      OPENCODE_CONFIG_DIR: customOpenCode,
    };

    const hosts = detectHosts({ env });
    assert.equal(hosts.find((host) => host.id === 'codex')?.path, codexPath);
    assert.equal(hosts.find((host) => host.id === 'agy')?.path, agyPath);
    assert.equal(hosts.find((host) => host.id === 'opencode')?.path, opencodePath);
    assert.equal(hosts.find((host) => host.id === 'claude')?.path, null);

    const active = selectDetectedHosts(hosts, []);
    const targets = resolveSkillTargets(active, { home, cwd, env });
    const dirs = new Set(targets.map((target) => target.dir));

    assert.ok(dirs.has(join(home, '.codex', 'skills', 'remote-compute')));
    assert.ok(dirs.has(join(home, '.agents', 'skills', 'remote-compute')));
    assert.ok(dirs.has(join(customOpenCode, 'skills', 'remote-compute')));
    assert.ok(dirs.has(join(home, '.gemini', 'config', 'skills', 'remote-compute')));
    assert.ok(dirs.has(join(cwd, '.agents', 'skills', 'remote-compute')));

    const codexOnly = selectDetectedHosts(hosts, ['--codex']);
    assert.deepEqual(codexOnly.map((host) => host.id), ['codex']);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

if (process.argv[1]?.endsWith('hosts.test.mjs')) {
  runHostTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOST_DEFINITIONS } from '../src/hosts.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGE_PATH = join(ROOT, 'package.json');
const SKILL_PATH = join(ROOT, 'skills', 'remote-compute', 'SKILL.md');

function normalizeNewlines(value) {
  return String(value).replace(/\r\n?/g, '\n');
}

export async function runContractTests() {
  console.log('--- contracts ---');

  const pkg = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'));
  assert.equal(pkg.name, '@lotargo/remote-compute');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.bin?.['remote-compute'], 'bin/remote-compute.mjs');
  assert.equal(existsSync(join(ROOT, pkg.bin['remote-compute'])), true, 'package bin target must exist');

  for (const path of ['bin', 'src', 'skills', 'README.md']) {
    assert.ok(pkg.files?.includes(path), `package files must include ${path}`);
  }

  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'runtime dependency contract is zero dependencies');

  const requiredScripts = [
    'lint',
    'check',
    'test',
    'test:contracts',
    'test:platform',
    'package:check',
    'verify',
  ];
  for (const script of requiredScripts) {
    assert.equal(typeof pkg.scripts?.[script], 'string', `missing npm script: ${script}`);
  }

  const ids = HOST_DEFINITIONS.map((host) => host.id);
  const commands = HOST_DEFINITIONS.map((host) => host.command);
  const flags = HOST_DEFINITIONS.map((host) => host.flag);
  assert.equal(new Set(ids).size, ids.length, 'host ids must be unique');
  assert.equal(new Set(commands).size, commands.length, 'host commands must be unique');
  assert.equal(new Set(flags).size, flags.length, 'host flags must be unique');
  for (const host of HOST_DEFINITIONS) {
    assert.match(host.flag, /^--[a-z0-9-]+$/);
    assert.ok(host.label.trim().length > 0);
    assert.ok(host.command.trim().length > 0);
  }

  const skill = normalizeNewlines(await readFile(SKILL_PATH, 'utf8'));
  assert.match(skill, /^---\n/);
  assert.match(skill, /\nname:\s*remote-compute\s*\n/);
  assert.match(skill, /managed-by:\s*remote-compute/);
  assert.match(skill, /provider:\s*colab/);
  assert.match(skill, /official `colab` CLI/i);

  const help = spawnSync(process.execPath, [join(ROOT, 'bin', 'remote-compute.mjs'), 'help'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  for (const command of ['setup', 'doctor', 'auth', 'uninstall']) {
    assert.match(help.stdout, new RegExp(`\\b${command}\\b`));
  }
  for (const flag of flags) {
    assert.ok(help.stdout.includes(flag), `help must document ${flag}`);
  }
}

if (process.argv[1]?.endsWith('contracts.test.mjs')) {
  runContractTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

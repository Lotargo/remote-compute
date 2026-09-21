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
const CHANGELOG_PATH = join(ROOT, 'CHANGELOG.md');
const WSL_TRANSPORT_PATH = join(ROOT, 'src', 'transports', 'wsl.mjs');

function normalizeNewlines(value) {
  return String(value).replace(/\r\n?/g, '\n');
}

export async function runContractTests() {
  console.log('--- contracts ---');

  const pkg = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'));
  assert.equal(pkg.name, '@lotargo/remote-compute');
  assert.match(pkg.description, /Google Colab/i, 'package description must keep the current Colab-first product focus visible');
  for (const keyword of ['google-colab', 'colab', 'colab-cli', 'remote-compute', 'coding-agents']) {
    assert.ok(pkg.keywords?.includes(keyword), `package keywords must include ${keyword}`);
  }
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.bin?.['remote-compute'], 'bin/remote-compute.mjs');
  assert.equal(existsSync(join(ROOT, pkg.bin['remote-compute'])), true, 'package bin target must exist');

  for (const path of ['bin', 'src', 'skills', 'README.md', 'CHANGELOG.md']) {
    assert.ok(pkg.files?.includes(path), `package files must include ${path}`);
  }
  assert.equal(existsSync(CHANGELOG_PATH), true, 'CHANGELOG.md must exist for releases');

  for (const path of [
    'src/transports/native.mjs',
    'src/transports/wsl.mjs',
  ]) {
    assert.equal(existsSync(join(ROOT, path)), true, `transport module must exist: ${path}`);
  }

  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'runtime dependency contract is zero dependencies');

  const requiredScripts = [
    'lint',
    'check',
    'test',
    'test:contracts',
    'test:platform',
    'test:colab',
    'test:gateway',
    'test:wsl',
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
  assert.match(skill, /remote-compute colab skill/);
  assert.match(skill, /remote-compute wsl-path/);
  assert.match(skill, /remote-compute colab drivemount/);
  assert.match(skill, /remote-compute colab upload/);
  assert.match(skill, /remote-compute colab download/);

  const changelog = normalizeNewlines(await readFile(CHANGELOG_PATH, 'utf8'));
  assert.match(changelog, /## \[0\.1\.0\] - 2026-09-22/);
  assert.match(changelog, /Windows -> WSL/i);
  assert.match(changelog, /OAuth2/i);
  assert.match(changelog, /Google Drive/i);
  assert.match(changelog, /Colab remote-compute integration/i);

  const wslSource = normalizeNewlines(await readFile(WSL_TRANSPORT_PATH, 'utf8'));
  assert.match(wslSource, /wslpath/);
  assert.doesNotMatch(
    wslSource,
    /\/mnt\/[a-z](?:\/|['"`])/i,
    'WSL path translation must not hardcode /mnt/<drive-letter>',
  );

  const help = spawnSync(process.execPath, [join(ROOT, 'bin', 'remote-compute.mjs'), 'help'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  for (const command of ['setup', 'doctor', 'auth', 'colab', 'wsl-path', 'uninstall']) {
    assert.match(help.stdout, new RegExp(`\\b${command}\\b`));
  }
  for (const flag of [...flags, '--install-wsl', '--wsl-distro']) {
    assert.ok(help.stdout.includes(flag), `help must document ${flag}`);
  }
}

if (process.argv[1]?.endsWith('contracts.test.mjs')) {
  runContractTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

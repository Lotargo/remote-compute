import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  inspectSkillDir,
  installSkillDirectory,
  isOwnedSkillDir,
  removeSkillTargets,
} from '../src/skills.mjs';

const SKILL_TEXT = `---\nname: remote-compute\nmetadata:\n  managed-by: remote-compute\n---\n\n# Remote Compute\n`;

export async function runSkillTests() {
  console.log('--- skills ---');
  const root = await mkdtemp(join(tmpdir(), 'remote-compute-skills-'));
  const packaged = join(root, 'packaged');
  const target = join(root, 'home', '.agents', 'skills', 'remote-compute');

  try {
    await mkdir(packaged, { recursive: true });
    await writeFile(join(packaged, 'SKILL.md'), SKILL_TEXT, 'utf8');
    await mkdir(join(packaged, 'references'), { recursive: true });
    await writeFile(join(packaged, 'references', 'provider.md'), 'provider docs\n', 'utf8');

    const installed = await installSkillDirectory(target, packaged);
    assert.equal(installed.status, 'installed');
    assert.equal(await isOwnedSkillDir(target, packaged), true);

    const current = await installSkillDirectory(target, packaged);
    assert.equal(current.status, 'current');

    await writeFile(join(target, 'custom.txt'), 'user customization\n', 'utf8');
    const state = await inspectSkillDir(target, packaged);
    assert.equal(state.managed, true);
    assert.equal(state.owned, false);

    const protectedInstall = await installSkillDirectory(target, packaged);
    assert.equal(protectedInstall.status, 'modified');
    assert.equal(await readFile(join(target, 'custom.txt'), 'utf8'), 'user customization\n');

    const output = { log() {}, warn() {}, error() {} };
    const removal = await removeSkillTargets([{ dir: target, label: target }], packaged, { output });
    assert.equal(removal[0].status, 'modified');
    assert.equal(await readFile(join(target, 'custom.txt'), 'utf8'), 'user customization\n');

    const refreshed = await installSkillDirectory(target, packaged, { force: true });
    assert.equal(refreshed.status, 'refreshed');
    await assert.rejects(readFile(join(target, 'custom.txt')), /ENOENT/);
    assert.equal(await isOwnedSkillDir(target, packaged), true);

    const preview = await removeSkillTargets([{ dir: target, label: target }], packaged, {
      dryRun: true,
      output,
    });
    assert.equal(preview[0].status, 'would_remove');
    assert.equal(await isOwnedSkillDir(target, packaged), true);

    await cp(packaged, join(root, 'foreign'), { recursive: true });
    await writeFile(join(root, 'foreign', 'SKILL.md'), '# foreign\n', 'utf8');
    const foreign = await installSkillDirectory(join(root, 'foreign'), packaged);
    assert.equal(foreign.status, 'conflict');
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

if (process.argv[1]?.endsWith('skills.test.mjs')) {
  runSkillTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

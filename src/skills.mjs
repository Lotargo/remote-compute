import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const MANAGED_MARKER = 'managed-by: remote-compute';

async function directoryContentsEqual(left, right) {
  const [leftEntries, rightEntries] = await Promise.all([
    readdir(left, { withFileTypes: true }),
    readdir(right, { withFileTypes: true }),
  ]);

  if (leftEntries.length !== rightEntries.length) return false;
  const leftMap = new Map(leftEntries.map((entry) => [entry.name, entry]));

  for (const rightEntry of rightEntries) {
    const leftEntry = leftMap.get(rightEntry.name);
    if (!leftEntry) return false;
    if (leftEntry.isDirectory() !== rightEntry.isDirectory()) return false;
    if (leftEntry.isFile() !== rightEntry.isFile()) return false;

    const leftPath = join(left, leftEntry.name);
    const rightPath = join(right, rightEntry.name);

    if (leftEntry.isDirectory()) {
      if (!await directoryContentsEqual(leftPath, rightPath)) return false;
      continue;
    }

    if (!leftEntry.isFile()) return false;
    const [leftData, rightData] = await Promise.all([
      readFile(leftPath),
      readFile(rightPath),
    ]);
    if (!leftData.equals(rightData)) return false;
  }

  return true;
}

export async function isOwnedSkillDir(skillDir, packagedSkillDir) {
  if (!existsSync(skillDir)) return false;
  try {
    return await directoryContentsEqual(skillDir, packagedSkillDir);
  } catch {
    return false;
  }
}

export async function isManagedSkillDir(skillDir) {
  if (!existsSync(skillDir)) return false;
  try {
    const skill = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    return skill.includes(MANAGED_MARKER);
  } catch {
    return false;
  }
}

export async function inspectSkillDir(skillDir, packagedSkillDir) {
  if (!existsSync(skillDir)) {
    return { exists: false, owned: false, managed: false };
  }
  const [owned, managed] = await Promise.all([
    isOwnedSkillDir(skillDir, packagedSkillDir),
    isManagedSkillDir(skillDir),
  ]);
  return { exists: true, owned, managed };
}

export async function installSkillDirectory(skillDir, packagedSkillDir, {
  force = false,
} = {}) {
  const state = await inspectSkillDir(skillDir, packagedSkillDir);

  if (state.owned && !force) return { status: 'current' };

  if (state.exists && !state.managed) {
    return { status: 'conflict', reason: 'target exists but is not owned by remote-compute' };
  }

  if (state.exists && state.managed && !force) {
    return {
      status: 'modified',
      reason: 'managed skill differs from the packaged copy; use --force to refresh it',
    };
  }

  if (state.exists) await rm(skillDir, { recursive: true, force: true });
  await mkdir(dirname(skillDir), { recursive: true });
  await cp(packagedSkillDir, skillDir, { recursive: true });
  return { status: state.exists ? 'refreshed' : 'installed' };
}

export async function installSkillTargets(targets, packagedSkillDir, {
  force = false,
  output = console,
} = {}) {
  const results = [];

  for (const target of targets) {
    const result = await installSkillDirectory(target.dir, packagedSkillDir, { force });
    results.push({ ...target, ...result });

    if (result.status === 'installed' || result.status === 'refreshed') {
      output.log(`✓ ${result.status} skill: ${target.label}`);
    } else if (result.status === 'current') {
      output.log(`✓ skill already current: ${target.label}`);
    } else {
      output.warn(`! ${target.label}: ${result.reason}`);
    }
  }

  return results;
}

export async function removeSkillTargets(targets, packagedSkillDir, {
  dryRun = false,
  output = console,
} = {}) {
  const results = [];

  for (const target of targets) {
    const state = await inspectSkillDir(target.dir, packagedSkillDir);
    if (!state.exists) {
      output.log(`· not installed: ${target.label}`);
      results.push({ ...target, status: 'not_found' });
      continue;
    }

    if (!state.owned) {
      const status = state.managed ? 'modified' : 'conflict';
      const detail = state.managed
        ? 'skill differs from the packaged copy; preserving possible user changes'
        : 'skill is not owned by remote-compute';
      output.warn(`! not removing ${target.label}: ${detail}`);
      results.push({ ...target, status });
      continue;
    }

    if (!dryRun) await rm(target.dir, { recursive: true, force: true });
    output.log(`${dryRun ? '· would remove' : '✓ removed'}: ${target.label}`);
    results.push({ ...target, status: dryRun ? 'would_remove' : 'removed' });
  }

  return results;
}

import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { resolveClientExecutable } from './client_cli.mjs';
import { resolveClientPaths } from './client_paths.mjs';

export const HOST_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'codex', command: 'codex', label: 'Codex', flag: '--codex' }),
  Object.freeze({ id: 'agy', command: 'agy', label: 'AGY / Antigravity CLI', flag: '--agy' }),
  Object.freeze({ id: 'opencode', command: 'opencode', label: 'OpenCode', flag: '--opencode' }),
  Object.freeze({ id: 'claude', command: 'claude', label: 'Claude Code', flag: '--claude' }),
]);

export function detectHosts({
  env = process.env,
  platform = process.platform,
} = {}) {
  return HOST_DEFINITIONS.map((host) => ({
    ...host,
    path: resolveClientExecutable(host.command, { env, platform }),
  }));
}

export function requestedHostIds(args = []) {
  const requested = new Set();
  for (const host of HOST_DEFINITIONS) {
    if (args.includes(host.flag)) requested.add(host.id);
  }
  return requested;
}

export function selectDetectedHosts(hosts, args = []) {
  const requested = requestedHostIds(args);
  if (requested.size === 0) return hosts.filter((host) => host.path);
  return hosts.filter((host) => host.path && requested.has(host.id));
}

export function selectKnownHosts(args = []) {
  const requested = requestedHostIds(args);
  if (requested.size === 0) return [...HOST_DEFINITIONS];
  return HOST_DEFINITIONS.filter((host) => requested.has(host.id));
}

function skillRootsForHost(hostId, paths) {
  switch (hostId) {
    case 'codex':
      return [paths.codexSkillsDir, paths.sharedAgentsSkillsDir];
    case 'agy': {
      const roots = [paths.agySkillsDir];
      if (existsSync(paths.localAgentsDir)) roots.push(paths.localAgentsSkillsDir);
      return roots;
    }
    case 'opencode':
      return [paths.opencodeSkillsDir];
    case 'claude':
      return [paths.claudeSkillsDir];
    default:
      return [];
  }
}

export function resolveSkillTargets(hosts, {
  home,
  cwd,
  env = process.env,
} = {}) {
  const paths = resolveClientPaths({ home, cwd, env });
  const byPath = new Map();

  for (const host of hosts) {
    for (const root of skillRootsForHost(host.id, paths)) {
      const dir = join(root, 'remote-compute');
      const key = process.platform === 'win32'
        ? normalize(dir).toLowerCase()
        : normalize(dir);
      const existing = byPath.get(key);
      if (existing) {
        existing.hosts.push(host.id);
        continue;
      }
      byPath.set(key, {
        dir,
        label: dir,
        hosts: [host.id],
      });
    }
  }

  return [...byPath.values()];
}

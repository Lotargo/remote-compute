import { homedir } from 'node:os';
import { join } from 'node:path';

export function resolveClientPaths({
  home = homedir(),
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const configHome = env.XDG_CONFIG_HOME || join(home, '.config');
  const cacheHome = env.XDG_CACHE_HOME || join(home, '.cache');
  const opencodeDir = env.OPENCODE_CONFIG_DIR || join(configHome, 'opencode');
  const geminiDir = join(home, '.gemini');
  const antigravityConfigDir = join(geminiDir, 'config');

  return {
    home,
    cwd,
    configHome,
    cacheHome,
    opencodeDir,
    sharedAgentsSkillsDir: join(home, '.agents', 'skills'),
    codexSkillsDir: join(home, '.codex', 'skills'),
    claudeSkillsDir: join(home, '.claude', 'skills'),
    opencodeSkillsDir: join(opencodeDir, 'skills'),
    geminiDir,
    antigravityConfigDir,
    agySkillsDir: join(antigravityConfigDir, 'skills'),
    localAgentsDir: join(cwd, '.agents'),
    localAgentsSkillsDir: join(cwd, '.agents', 'skills'),
    remoteComputeConfigDir: join(configHome, 'remote-compute'),
  };
}

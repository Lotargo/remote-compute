import { win32 } from 'node:path';

import { cliFailureMessage, resolveClientExecutable, runClientCli } from '../client_cli.mjs';

function cleanWslText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '');
}

export function parseWslDistributionList(value) {
  return cleanWslText(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function requestedDistribution({ env = process.env, distro = null } = {}) {
  return distro || env.REMOTE_COMPUTE_WSL_DISTRO || null;
}

function canonicalDistribution(requested, installed) {
  if (!requested) return null;
  const lowered = String(requested).toLowerCase();
  return installed.find((name) => name.toLowerCase() === lowered) || null;
}

export function buildWslExecArgs(command, args = [], {
  distro = null,
  cwd = null,
} = {}) {
  const result = [];
  if (distro) result.push('--distribution', distro);
  if (cwd && win32.isAbsolute(cwd)) result.push('--cd', cwd);
  result.push('--exec', command, ...args);
  return result;
}

export function getWslExecutable({
  env = process.env,
  platform = process.platform,
} = {}) {
  if (platform !== 'win32') return null;
  return resolveClientExecutable('wsl', { env, platform });
}

export function listWslDistributions({
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  runner = runClientCli,
} = {}) {
  const executable = getWslExecutable({ env, platform });
  if (!executable) {
    return { ok: false, reason: 'missing_wsl', executable: null, distributions: [] };
  }

  const result = runner('wsl', ['--list', '--quiet'], {
    env,
    platform,
    cwd,
    timeout: 15_000,
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: 'wsl_unavailable',
      executable,
      distributions: [],
      detail: cliFailureMessage(result),
    };
  }

  const distributions = parseWslDistributionList(result.stdout);
  if (distributions.length === 0) {
    return {
      ok: false,
      reason: 'no_distribution',
      executable,
      distributions,
    };
  }

  return { ok: true, executable, distributions };
}

export function inspectWsl({
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  distro = null,
  runner = runClientCli,
} = {}) {
  if (platform !== 'win32') {
    return { ok: false, reason: 'not_windows', executable: null, distributions: [] };
  }

  const listed = listWslDistributions({ env, platform, cwd, runner });
  if (!listed.ok) return listed;

  const requested = requestedDistribution({ env, distro });
  const selected = canonicalDistribution(requested, listed.distributions);
  if (requested && !selected) {
    return {
      ok: false,
      reason: 'requested_distribution_missing',
      executable: listed.executable,
      distributions: listed.distributions,
      requestedDistribution: requested,
    };
  }

  return {
    ok: true,
    executable: listed.executable,
    distributions: listed.distributions,
    distro: selected,
    usesDefaultDistribution: !selected,
  };
}

export function runWslCommand(command, args = [], {
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  distro = null,
  timeout = 20_000,
  inherit = false,
  bridgeCwd = true,
  runner = runClientCli,
} = {}) {
  if (platform !== 'win32') {
    return {
      available: false,
      ok: false,
      status: null,
      executable: null,
      stdout: '',
      stderr: 'WSL transport is only available on Windows.',
      error: null,
    };
  }

  const selected = requestedDistribution({ env, distro });
  const wslCwd = bridgeCwd ? cwd : null;
  return runner('wsl', buildWslExecArgs(command, args, { distro: selected, cwd: wslCwd }), {
    env,
    platform,
    cwd,
    timeout,
    inherit,
  });
}

export function resolveWslCommand(command, {
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  distro = null,
  runner = runClientCli,
} = {}) {
  const state = inspectWsl({ env, platform, cwd, distro, runner });
  if (!state.ok) return { ok: false, ...state, command, path: null };

  const result = runWslCommand('/bin/sh', [
    '-lc',
    'command -v "$1"',
    'remote-compute',
    command,
  ], {
    env,
    platform,
    cwd,
    distro: state.distro,
    timeout: 15_000,
    bridgeCwd: false,
    runner,
  });

  if (!result.ok) {
    return {
      ok: false,
      reason: 'command_missing',
      command,
      path: null,
      distro: state.distro,
      detail: cliFailureMessage(result),
    };
  }

  const path = cleanWslText(result.stdout).trim().split('\n')[0] || null;
  return {
    ok: Boolean(path),
    reason: path ? null : 'command_missing',
    command,
    path,
    distro: state.distro,
  };
}

export function windowsPathToWsl(windowsPath, {
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  distro = null,
  runner = runClientCli,
} = {}) {
  if (platform !== 'win32' || !win32.isAbsolute(windowsPath)) {
    return { ok: false, reason: 'not_absolute_windows_path', path: null };
  }

  const state = inspectWsl({ env, platform, cwd, distro, runner });
  if (!state.ok) return { ok: false, ...state, path: null };

  const result = runWslCommand('wslpath', ['-a', '-u', windowsPath], {
    env,
    platform,
    cwd,
    distro: state.distro,
    timeout: 15_000,
    bridgeCwd: false,
    runner,
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: 'path_translation_failed',
      path: null,
      detail: cliFailureMessage(result),
    };
  }

  const path = cleanWslText(result.stdout).trim().split('\n')[0] || null;
  return { ok: Boolean(path), reason: path ? null : 'path_translation_failed', path };
}

export function createWslTransport({
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  distro = null,
  runner = runClientCli,
} = {}) {
  const state = inspectWsl({ env, platform, cwd, distro, runner });
  if (!state.ok) return { ok: false, ...state, transport: null };

  const transport = {
    id: 'wsl',
    label: state.distro ? `WSL (${state.distro})` : 'WSL (default distribution)',
    distro: state.distro,
    cwd,
    resolve(command) {
      const resolved = resolveWslCommand(command, {
        env,
        platform,
        cwd,
        distro: state.distro,
        runner,
      });
      return resolved.ok ? resolved.path : null;
    },
    run(command, args = [], options = {}) {
      const executable = command.includes('/') ? command : (transport.resolve(command) || command);
      return runWslCommand(executable, args, {
        env,
        platform,
        cwd: options.cwd ?? cwd,
        distro: state.distro,
        timeout: options.timeout,
        inherit: options.inherit ?? false,
        bridgeCwd: options.bridgeCwd ?? true,
        runner,
      });
    },
    toLinuxPath(path) {
      return windowsPathToWsl(path, {
        env,
        platform,
        cwd,
        distro: state.distro,
        runner,
      });
    },
  };

  return { ok: true, ...state, transport };
}

export function installWsl({
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  distro = 'Ubuntu',
  output = console,
  runner = runClientCli,
} = {}) {
  if (platform !== 'win32') return { ok: false, reason: 'not_windows' };
  if (!getWslExecutable({ env, platform })) return { ok: false, reason: 'missing_wsl_executable' };

  output.log(`Installing WSL distribution ${distro} through Windows...`);
  const result = runner('wsl', [
    '--install',
    '--distribution',
    distro,
    '--no-launch',
  ], {
    env,
    platform,
    cwd,
    timeout: 15 * 60_000,
    inherit: true,
  });

  if (!result.ok) {
    return { ok: false, reason: 'install_failed', detail: cliFailureMessage(result) };
  }

  return {
    ok: true,
    distro,
    restartMayBeRequired: true,
    initializationMayBeRequired: true,
  };
}

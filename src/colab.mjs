import { cliFailureMessage, resolveClientExecutable, runClientCli } from './client_cli.mjs';

const COLAB_INSTALLERS = Object.freeze([
  Object.freeze({ command: 'uv', args: ['tool', 'install', 'google-colab-cli'] }),
  Object.freeze({ command: 'python3', args: ['-m', 'pip', 'install', '--user', 'google-colab-cli'] }),
  Object.freeze({ command: 'python', args: ['-m', 'pip', 'install', '--user', 'google-colab-cli'] }),
]);

const COLAB_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/colaboratory',
].join(',');

export function getColabExecutable({ env = process.env, platform = process.platform } = {}) {
  return resolveClientExecutable('colab', { env, platform });
}

export function checkColabAccess({
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
} = {}) {
  const executable = getColabExecutable({ env, platform });
  if (!executable) return { ok: false, reason: 'missing', executable: null };

  const result = runClientCli('colab', ['sessions'], {
    env,
    platform,
    cwd,
    timeout: 30_000,
  });

  if (result.ok) return { ok: true, executable };
  return {
    ok: false,
    reason: 'auth_or_provider',
    executable,
    detail: cliFailureMessage(result),
  };
}

export function installColabCli({
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  output = console,
} = {}) {
  for (const installer of COLAB_INSTALLERS) {
    if (!resolveClientExecutable(installer.command, { env, platform })) continue;

    output.log(`Installing google-colab-cli with ${installer.command}...`);
    const result = runClientCli(installer.command, installer.args, {
      env,
      platform,
      cwd,
      timeout: 300_000,
      inherit: true,
    });

    if (!result.ok) {
      output.warn(`! ${installer.command} failed: ${cliFailureMessage(result)}`);
      continue;
    }

    const colab = getColabExecutable({ env, platform });
    if (colab) {
      output.log(`✓ Colab CLI installed: ${colab}`);
      return { ok: true, executable: colab, installer: installer.command };
    }

    output.warn('! Installation completed, but `colab` is not visible on PATH in this process yet.');
    return { ok: true, executable: null, installer: installer.command, pathRefreshNeeded: true };
  }

  output.error('Could not install google-colab-cli automatically. Install `uv` or Python first, then run:');
  output.error('  uv tool install google-colab-cli');
  return { ok: false, executable: null };
}

export function authenticateColab({
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  output = console,
} = {}) {
  const colab = getColabExecutable({ env, platform });
  if (!colab) {
    return { ok: false, reason: 'missing_colab' };
  }

  const existing = checkColabAccess({ env, platform, cwd });
  if (existing.ok) return { ok: true, alreadyAuthenticated: true };

  const gcloud = resolveClientExecutable('gcloud', { env, platform });
  if (!gcloud) return { ok: false, reason: 'missing_gcloud' };

  output.log('Opening the official Google Application Default Credentials flow...');
  const login = runClientCli('gcloud', [
    'auth',
    'application-default',
    'login',
    `--scopes=${COLAB_SCOPES}`,
  ], {
    env,
    platform,
    cwd,
    timeout: 300_000,
    inherit: true,
  });

  if (!login.ok) {
    return { ok: false, reason: 'gcloud_auth_failed', detail: cliFailureMessage(login) };
  }

  const verified = checkColabAccess({ env, platform, cwd });
  if (!verified.ok) {
    return {
      ok: false,
      reason: 'verification_failed',
      detail: verified.detail,
    };
  }

  return { ok: true, alreadyAuthenticated: false };
}

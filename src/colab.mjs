import { cliFailureMessage } from './client_cli.mjs';
import { createNativeTransport } from './transports/native.mjs';
import { createWslTransport } from './transports/wsl.mjs';

const UV_INSTALL_URL = 'https://astral.sh/uv/install.sh';
const DEFAULT_AUTH_PROVIDER = 'oauth2';

const COLAB_INSTALLERS = Object.freeze([
  Object.freeze({ command: 'uv', args: ['tool', 'install', 'google-colab-cli'] }),
  Object.freeze({ command: 'pipx', args: ['install', 'google-colab-cli'] }),
]);

function hasExplicitAuth(args = []) {
  return args.some((arg) => arg === '--auth' || String(arg).startsWith('--auth='));
}

export function withDefaultColabAuth(args = []) {
  if (hasExplicitAuth(args)) return [...args];
  return [`--auth=${DEFAULT_AUTH_PROVIDER}`, ...args];
}

export function resolveColabRuntime({
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  runner,
} = {}) {
  const native = createNativeTransport({ env, platform, cwd });
  const nativeColab = native.resolve('colab');
  if (nativeColab) {
    return {
      ok: true,
      mode: 'native',
      transport: native,
      executable: nativeColab,
      label: `native (${nativeColab})`,
    };
  }

  if (platform !== 'win32') {
    return {
      ok: false,
      reason: 'missing_colab',
      mode: 'native',
      transport: native,
      executable: null,
    };
  }

  const wsl = createWslTransport({ env, platform, cwd, runner });
  if (!wsl.ok) {
    return {
      ok: false,
      reason: wsl.reason,
      mode: 'wsl',
      transport: null,
      executable: null,
      wsl,
    };
  }

  const wslColab = wsl.transport.resolve('colab');
  if (!wslColab) {
    return {
      ok: false,
      reason: 'missing_colab_wsl',
      mode: 'wsl',
      transport: wsl.transport,
      executable: null,
      wsl,
    };
  }

  return {
    ok: true,
    mode: 'wsl',
    transport: wsl.transport,
    executable: wslColab,
    label: `${wsl.transport.label} (${wslColab})`,
    wsl,
  };
}

export function getColabExecutable(options = {}) {
  const runtime = resolveColabRuntime(options);
  return runtime.ok ? runtime.executable : null;
}

export function checkColabAccess({
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  runner,
} = {}) {
  const runtime = resolveColabRuntime({ env, platform, cwd, runner });
  if (!runtime.ok) {
    return {
      ok: false,
      reason: runtime.reason,
      executable: null,
      runtime,
    };
  }

  const result = runtime.transport.run('colab', withDefaultColabAuth(['sessions']), {
    cwd,
    timeout: 30_000,
    bridgeCwd: false,
  });

  if (result.ok) {
    return {
      ok: true,
      executable: runtime.executable,
      runtime,
      authProvider: DEFAULT_AUTH_PROVIDER,
    };
  }

  const detail = cliFailureMessage(result);
  const authRequired = /^aborted\.?$/i.test(detail.trim());

  return {
    ok: false,
    reason: authRequired ? 'auth_required' : 'auth_or_provider',
    executable: runtime.executable,
    runtime,
    authProvider: DEFAULT_AUTH_PROVIDER,
    detail: authRequired ? 'interactive Colab OAuth2 login is required' : detail,
  };
}

function bootstrapUv(transport, {
  output = console,
} = {}) {
  const existing = transport.resolve('uv');
  if (existing) {
    return { ok: true, executable: existing, alreadyInstalled: true };
  }

  const curl = transport.resolve('curl');
  const wget = transport.resolve('wget');
  if (!curl && !wget) {
    return {
      ok: false,
      reason: 'missing_downloader',
      detail: 'neither curl nor wget is available for the official uv standalone installer',
    };
  }

  output.log(`uv is not available in ${transport.label}; bootstrapping the official uv standalone installer...`);

  const script = [
    'set -eu',
    'tmp="$(mktemp)"',
    'trap \'rm -f "$tmp"\' EXIT',
    `if command -v curl >/dev/null 2>&1; then curl -LsSf '${UV_INSTALL_URL}' -o "$tmp"; else wget -qO "$tmp" '${UV_INSTALL_URL}'; fi`,
    'UV_UNMANAGED_INSTALL="$HOME/.local/bin" sh "$tmp"',
  ].join('\n');

  const result = transport.run('sh', ['-lc', script], {
    timeout: 300_000,
    inherit: true,
    bridgeCwd: false,
  });

  if (!result.ok) {
    return {
      ok: false,
      reason: 'uv_bootstrap_failed',
      detail: cliFailureMessage(result),
    };
  }

  const uv = transport.resolve('uv');
  if (!uv) {
    return {
      ok: false,
      reason: 'uv_not_visible',
      detail: 'uv installation finished, but the executable could not be resolved from the provider environment',
    };
  }

  output.log(`✓ uv ready via ${transport.label}: ${uv}`);
  return { ok: true, executable: uv, alreadyInstalled: false };
}

function tryInstaller(transport, installer, {
  output = console,
} = {}) {
  if (!transport.resolve(installer.command)) return null;

  output.log(`Installing google-colab-cli with ${installer.command} via ${transport.label}...`);
  const result = transport.run(installer.command, installer.args, {
    timeout: 300_000,
    inherit: true,
    bridgeCwd: false,
  });

  if (!result.ok) {
    output.warn(`! ${installer.command} failed: ${cliFailureMessage(result)}`);
    return { ok: false, reason: 'installer_failed', installer: installer.command };
  }

  const colab = transport.resolve('colab');
  if (colab) {
    output.log(`✓ Colab CLI installed via ${transport.label}: ${colab}`);
    return {
      ok: true,
      executable: colab,
      installer: installer.command,
      transport,
    };
  }

  output.warn('! Installation completed, but `colab` is not visible to the selected transport yet.');
  return {
    ok: true,
    executable: null,
    installer: installer.command,
    transport,
    pathRefreshNeeded: true,
  };
}

function installIntoTransport(transport, {
  output = console,
} = {}) {
  if (!transport.resolve('uv')) {
    const bootstrapped = bootstrapUv(transport, { output });
    if (!bootstrapped.ok) {
      output.warn(`! Could not bootstrap uv: ${bootstrapped.detail || bootstrapped.reason}`);
    }
  }

  for (const installer of COLAB_INSTALLERS) {
    const installed = tryInstaller(transport, installer, { output });
    if (!installed) continue;
    if (installed.ok) return installed;
  }

  output.error(`Could not install google-colab-cli through ${transport.label}.`);
  output.error('The provider environment needs uv or pipx; remote-compute will not bypass PEP 668 with --break-system-packages.');
  return { ok: false, executable: null, reason: 'missing_installer', transport };
}

export function installColabCli({
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  output = console,
  runner,
} = {}) {
  const existing = resolveColabRuntime({ env, platform, cwd, runner });
  if (existing.ok) {
    return {
      ok: true,
      executable: existing.executable,
      transport: existing.transport,
      alreadyInstalled: true,
    };
  }

  if (platform === 'win32') {
    const wsl = createWslTransport({ env, platform, cwd, runner });
    if (!wsl.ok) {
      return {
        ok: false,
        executable: null,
        reason: wsl.reason,
        wsl,
      };
    }
    return installIntoTransport(wsl.transport, { output });
  }

  const native = createNativeTransport({ env, platform, cwd });
  return installIntoTransport(native, { output });
}

export function authenticateColab({
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  output = console,
  runner,
} = {}) {
  const runtime = resolveColabRuntime({ env, platform, cwd, runner });
  if (!runtime.ok) {
    return {
      ok: false,
      reason: runtime.reason === 'missing_colab_wsl' ? 'missing_colab' : runtime.reason,
      runtime,
    };
  }

  const existing = checkColabAccess({ env, platform, cwd, runner });
  if (existing.ok) {
    return {
      ok: true,
      alreadyAuthenticated: true,
      runtime,
      authProvider: DEFAULT_AUTH_PROVIDER,
    };
  }

  output.log(`Starting the official Colab OAuth2 login via ${runtime.transport.label}...`);
  output.log('Open the URL printed by Colab, sign in with Google, then paste the authorization code back into this terminal.');

  const login = runtime.transport.run('colab', withDefaultColabAuth(['sessions']), {
    cwd,
    timeout: 10 * 60_000,
    inherit: true,
    bridgeCwd: false,
  });

  if (!login.ok) {
    return {
      ok: false,
      reason: 'oauth2_auth_failed',
      runtime,
      detail: cliFailureMessage(login),
    };
  }

  const verified = checkColabAccess({ env, platform, cwd, runner });
  if (!verified.ok) {
    return {
      ok: false,
      reason: 'verification_failed',
      runtime,
      detail: verified.detail,
    };
  }

  return {
    ok: true,
    alreadyAuthenticated: false,
    runtime,
    authProvider: DEFAULT_AUTH_PROVIDER,
  };
}

export function forwardColab(args = [], {
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
  runner,
} = {}) {
  const runtime = resolveColabRuntime({ env, platform, cwd, runner });
  if (!runtime.ok) {
    return {
      ok: false,
      reason: runtime.reason,
      runtime,
      status: null,
    };
  }

  const result = runtime.transport.run('colab', withDefaultColabAuth(args), {
    cwd,
    timeout: null,
    inherit: true,
    bridgeCwd: true,
  });

  return {
    ok: result.ok,
    status: result.status,
    reason: result.ok ? null : 'provider_failed',
    runtime,
    detail: result.ok ? null : cliFailureMessage(result),
  };
}

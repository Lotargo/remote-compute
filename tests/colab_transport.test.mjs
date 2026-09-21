import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkColabAccess,
  installColabCli,
  resolveColabRuntime,
  withDefaultColabAuth,
} from '../src/colab.mjs';

function result({ ok = true, stdout = '', stderr = '', status = ok ? 0 : 1 } = {}) {
  return {
    available: true,
    ok,
    status,
    executable: 'wsl.exe',
    stdout,
    stderr,
    error: null,
  };
}

const quietOutput = Object.freeze({
  log() {},
  warn() {},
  error() {},
});

export async function runColabTransportTests() {
  console.log('--- Colab transport ---');

  assert.deepEqual(withDefaultColabAuth(['sessions']), ['--auth=oauth2', 'sessions']);
  assert.deepEqual(withDefaultColabAuth(['--auth=adc', 'sessions']), ['--auth=adc', 'sessions']);
  assert.deepEqual(withDefaultColabAuth(['--auth', 'adc', 'sessions']), ['--auth', 'adc', 'sessions']);

  const root = await mkdtemp(join(tmpdir(), 'remote-compute-colab-transport-'));
  const nativeBin = join(root, 'native-bin');
  const wslBin = join(root, 'wsl-bin');
  await Promise.all([
    mkdir(nativeBin, { recursive: true }),
    mkdir(wslBin, { recursive: true }),
  ]);

  try {
    await writeFile(join(nativeBin, 'colab.exe'), '', 'utf8');
    await writeFile(join(nativeBin, 'wsl.exe'), '', 'utf8');
    const nativeEnv = {
      PATH: nativeBin,
      PATHEXT: '.EXE;.CMD;.BAT;.COM',
    };

    const native = resolveColabRuntime({
      env: nativeEnv,
      platform: 'win32',
      cwd: 'C:\\repo',
    });
    assert.equal(native.ok, true);
    assert.equal(native.mode, 'native', 'future native Windows Colab support must win over WSL fallback');
    assert.equal(native.transport.id, 'native');

    await writeFile(join(wslBin, 'wsl.exe'), '', 'utf8');
    const wslEnv = {
      PATH: wslBin,
      PATHEXT: '.EXE;.CMD;.BAT;.COM',
    };
    let uvInstalled = false;
    let colabInstalled = false;
    let uvBootstrapCalls = 0;
    const uvCalls = [];
    const colabCalls = [];

    const runner = (_name, args) => {
      if (args[0] === '--list') return result({ stdout: 'Ubuntu\r\n' });
      const execIndex = args.indexOf('--exec');
      const command = execIndex >= 0 ? args[execIndex + 1] : null;

      if (command === '/bin/sh') {
        const isResolver = args.includes('remote-compute');
        if (isResolver) {
          const requested = args.at(-1);
          if (requested === 'sh') return result({ stdout: '/bin/sh\n' });
          if (requested === 'curl') return result({ stdout: '/usr/bin/curl\n' });
          if (requested === 'uv' && uvInstalled) {
            return result({ stdout: '/home/test/.local/bin/uv\n' });
          }
          if (requested === 'colab' && colabInstalled) {
            return result({ stdout: '/home/test/.local/bin/colab\n' });
          }
          return result({ ok: false, stderr: 'missing\n' });
        }

        if (args.join(' ').includes('astral.sh/uv/install.sh')) {
          uvBootstrapCalls += 1;
          uvInstalled = true;
          return result();
        }

        return result();
      }

      if (command?.endsWith('/uv') || command === 'uv') {
        uvCalls.push(args.slice(execIndex + 2));
        colabInstalled = true;
        return result();
      }
      if (command?.endsWith('/colab') || command === 'colab') {
        colabCalls.push(args.slice(execIndex + 2));
        if (args.includes('sessions')) return result({ stdout: '[]\n' });
      }
      return result();
    };

    const beforeInstall = resolveColabRuntime({
      env: wslEnv,
      platform: 'win32',
      cwd: 'Z:\\repo',
      runner,
    });
    assert.equal(beforeInstall.ok, false);
    assert.equal(beforeInstall.reason, 'missing_colab_wsl');
    assert.equal(beforeInstall.transport.id, 'wsl');

    const installed = installColabCli({
      env: wslEnv,
      platform: 'win32',
      cwd: 'Z:\\repo',
      runner,
      output: quietOutput,
    });
    assert.equal(installed.ok, true);
    assert.equal(installed.transport.id, 'wsl');
    assert.equal(installed.installer, 'uv');
    assert.equal(uvBootstrapCalls, 1, 'missing uv should be bootstrapped exactly once through the official installer');
    assert.equal(uvCalls.length, 1);
    assert.deepEqual(uvCalls[0].slice(0, 4), [
      'tool',
      'install',
      'google-colab-cli',
      '--with',
    ]);
    assert.match(
      uvCalls[0][4],
      /^jupyter-kernel-client @ git\+https:\/\/github\.com\/googlecolab\/jupyter-kernel-client\.git@[0-9a-f]{40}$/,
      'uv installs must override the incompatible PyPI package with the official pinned Google Colab fork',
    );

    const afterInstall = resolveColabRuntime({
      env: wslEnv,
      platform: 'win32',
      cwd: 'Z:\\repo',
      runner,
    });
    assert.equal(afterInstall.ok, true);
    assert.equal(afterInstall.mode, 'wsl');
    assert.equal(afterInstall.transport.id, 'wsl');

    const access = checkColabAccess({
      env: wslEnv,
      platform: 'win32',
      cwd: 'Z:\\repo',
      runner,
    });
    assert.equal(access.ok, true);
    assert.equal(access.runtime.mode, 'wsl');
    assert.ok(
      colabCalls.some((args) => args[0] === '--auth=oauth2' && args[1] === 'sessions'),
      'managed read-only access checks must use the explicit oauth2 provider',
    );

    let pipxColabInstalled = false;
    const pipxCalls = [];
    const pipxRunner = (_name, args) => {
      if (args[0] === '--list') return result({ stdout: 'Ubuntu\r\n' });
      const execIndex = args.indexOf('--exec');
      const command = execIndex >= 0 ? args[execIndex + 1] : null;

      if (command === '/bin/sh') {
        const isResolver = args.includes('remote-compute');
        if (!isResolver) return result();
        const requested = args.at(-1);
        if (requested === 'sh') return result({ stdout: '/bin/sh\n' });
        if (requested === 'pipx') return result({ stdout: '/usr/bin/pipx\n' });
        if (requested === 'colab' && pipxColabInstalled) {
          return result({ stdout: '/home/test/.local/bin/colab\n' });
        }
        return result({ ok: false, stderr: 'missing\n' });
      }

      if (command?.endsWith('/pipx') || command === 'pipx') {
        const forwarded = args.slice(execIndex + 2);
        pipxCalls.push(forwarded);
        if (forwarded[0] === 'inject') pipxColabInstalled = true;
        return result();
      }
      return result();
    };

    const pipxInstalled = installColabCli({
      env: wslEnv,
      platform: 'win32',
      cwd: 'Z:\\repo',
      runner: pipxRunner,
      output: quietOutput,
    });
    assert.equal(pipxInstalled.ok, true);
    assert.equal(pipxInstalled.installer, 'pipx');
    assert.equal(pipxCalls.length, 2);
    assert.deepEqual(pipxCalls[0], ['install', 'google-colab-cli']);
    assert.deepEqual(pipxCalls[1].slice(0, 3), ['inject', '--force', 'google-colab-cli']);
    assert.match(
      pipxCalls[1][3],
      /^jupyter-kernel-client @ git\+https:\/\/github\.com\/googlecolab\/jupyter-kernel-client\.git@[0-9a-f]{40}$/,
      'pipx fallback must inject the official pinned Google Colab fork',
    );
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

if (process.argv[1]?.endsWith('colab_transport.test.mjs')) {
  runColabTransportTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

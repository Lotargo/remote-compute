import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkColabAccess, installColabCli, resolveColabRuntime } from '../src/colab.mjs';

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
    let colabInstalled = false;

    const runner = (_name, args) => {
      if (args[0] === '--list') return result({ stdout: 'Ubuntu\r\n' });
      const execIndex = args.indexOf('--exec');
      const command = execIndex >= 0 ? args[execIndex + 1] : null;

      if (command === '/bin/sh') {
        const requested = args.at(-1);
        if (requested === 'uv') return result({ stdout: '/home/test/.local/bin/uv\n' });
        if (requested === 'colab' && colabInstalled) {
          return result({ stdout: '/home/test/.local/bin/colab\n' });
        }
        return result({ ok: false, stderr: 'missing\n' });
      }

      if (command?.endsWith('/uv') || command === 'uv') {
        colabInstalled = true;
        return result();
      }
      if ((command?.endsWith('/colab') || command === 'colab') && args.includes('sessions')) {
        return result({ stdout: '[]\n' });
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

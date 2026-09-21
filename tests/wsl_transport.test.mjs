import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildWslExecArgs,
  createWslTransport,
  inspectWsl,
  installWsl,
  parseWslDistributionList,
  windowsPathToWsl,
} from '../src/transports/wsl.mjs';

function okResult(stdout = '') {
  return {
    available: true,
    ok: true,
    status: 0,
    executable: 'wsl.exe',
    stdout,
    stderr: '',
    error: null,
  };
}

const quietOutput = Object.freeze({
  log() {},
  warn() {},
  error() {},
});

export async function runWslTransportTests() {
  console.log('--- WSL transport ---');

  assert.deepEqual(
    parseWslDistributionList('U\u0000b\u0000u\u0000n\u0000t\u0000u\u0000\r\nD\u0000e\u0000b\u0000i\u0000a\u0000n\u0000\r\n'),
    ['Ubuntu', 'Debian'],
  );

  assert.deepEqual(
    buildWslExecArgs('colab', ['sessions'], {
      distro: 'Ubuntu',
      cwd: 'Z:\\projects\\remote-compute',
    }),
    [
      '--distribution',
      'Ubuntu',
      '--cd',
      'Z:\\projects\\remote-compute',
      '--exec',
      'colab',
      'sessions',
    ],
  );

  const root = await mkdtemp(join(tmpdir(), 'remote-compute-wsl-'));
  const binDir = join(root, 'bin');
  await mkdir(binDir, { recursive: true });
  await writeFile(join(binDir, 'wsl.exe'), '', 'utf8');

  const env = {
    PATH: binDir,
    PATHEXT: '.EXE;.CMD;.BAT;.COM',
    REMOTE_COMPUTE_WSL_DISTRO: 'ubuntu',
  };
  const calls = [];

  const runner = (_name, args) => {
    calls.push([...args]);
    if (args[0] === '--list') return okResult('Ubuntu\r\nDebian\r\n');
    if (args[0] === '--install') return okResult();

    const execIndex = args.indexOf('--exec');
    const command = execIndex >= 0 ? args[execIndex + 1] : null;
    if (command === '/bin/sh') return okResult('/home/test/.local/bin/colab\n');
    if (command === 'wslpath') {
      const windowsPath = args.at(-1);
      return okResult(`/translated/${windowsPath.replace(/[:\\]/g, '_')}\n`);
    }
    if (command === 'colab') return okResult('session-list\n');
    return okResult();
  };

  try {
    const state = inspectWsl({ env, platform: 'win32', cwd: 'C:\\work', runner });
    assert.equal(state.ok, true);
    assert.equal(state.distro, 'Ubuntu', 'distro override should resolve case-insensitively to installed name');

    const created = createWslTransport({ env, platform: 'win32', cwd: 'F:\\projects\\repo', runner });
    assert.equal(created.ok, true);
    assert.equal(created.transport.id, 'wsl');
    assert.equal(created.transport.distro, 'Ubuntu');
    assert.equal(created.transport.resolve('colab'), '/home/test/.local/bin/colab');

    const providerRun = created.transport.run('colab', ['sessions']);
    assert.equal(providerRun.ok, true);
    const providerCall = calls.find((args) => args.includes('colab') && args.includes('sessions'));
    assert.ok(providerCall, 'provider command should be executed through wsl.exe');
    assert.ok(providerCall.includes('F:\\projects\\repo'), 'Windows cwd should be passed to WSL via --cd');

    for (const windowsPath of [
      'C:\\projects\\file.bin',
      'F:\\projects\\file.bin',
      'Z:\\projects\\file.bin',
    ]) {
      const translated = windowsPathToWsl(windowsPath, {
        env,
        platform: 'win32',
        cwd: 'C:\\work',
        runner,
      });
      assert.equal(translated.ok, true);
      assert.ok(translated.path.startsWith('/translated/'));
      assert.ok(
        calls.some((args) => args.includes('wslpath') && args.includes(windowsPath)),
        `path must be delegated to wslpath without hardcoded drive mapping: ${windowsPath}`,
      );
    }

    const installed = installWsl({
      env,
      platform: 'win32',
      cwd: 'C:\\work',
      distro: 'Ubuntu',
      output: quietOutput,
      runner,
    });
    assert.equal(installed.ok, true);
    assert.ok(calls.some((args) => (
      args[0] === '--install'
      && args.includes('--distribution')
      && args.includes('Ubuntu')
      && args.includes('--no-launch')
    )), 'WSL setup should delegate installation to wsl.exe without Docker or custom VM logic');

    const missingDistro = inspectWsl({
      env: { ...env, REMOTE_COMPUTE_WSL_DISTRO: 'Fedora' },
      platform: 'win32',
      runner,
    });
    assert.equal(missingDistro.ok, false);
    assert.equal(missingDistro.reason, 'requested_distribution_missing');
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

if (process.argv[1]?.endsWith('wsl_transport.test.mjs')) {
  runWslTransportTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

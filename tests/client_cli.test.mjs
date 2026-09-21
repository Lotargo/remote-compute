import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { resolveClientExecutable, runClientCli } from '../src/client_cli.mjs';

export async function runClientCliTests() {
  console.log('--- client_cli ---');
  const root = await mkdtemp(join(tmpdir(), 'remote-compute-cli-'));
  const binDir = join(root, 'bin');
  const logPath = join(root, 'calls.log');
  await mkdir(binDir, { recursive: true });

  try {
    const isWindows = process.platform === 'win32';
    const executable = join(binDir, isWindows ? 'fake-client.cmd' : 'fake-client');
    const script = isWindows
      ? '@echo off\r\necho %*>>"%REMOTE_COMPUTE_CLI_LOG%"\r\nexit /b 0\r\n'
      : '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$REMOTE_COMPUTE_CLI_LOG"\n';

    await writeFile(executable, script, 'utf8');
    if (!isWindows) await chmod(executable, 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}${delimiter}${process.env.PATH || ''}`,
      PATHEXT: '.CMD;.EXE;.BAT;.COM',
      REMOTE_COMPUTE_CLI_LOG: logPath,
    };

    assert.equal(resolveClientExecutable('fake-client', { env }), executable);

    const result = runClientCli('fake-client', ['hello', 'world'], { env });
    assert.equal(result.available, true);
    assert.equal(result.ok, true, result.stderr || result.error?.message);
    assert.match(await readFile(logPath, 'utf8'), /hello world/);

    assert.equal(
      resolveClientExecutable('fake-client', {
        env: { ...env, REMOTE_COMPUTE_DISABLE_NATIVE_CLI: '1' },
      }),
      null,
    );
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

if (process.argv[1]?.endsWith('client_cli.test.mjs')) {
  runClientCliTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

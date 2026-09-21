import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = join(ROOT, 'bin', 'remote-compute.mjs');

export async function runProviderGatewayTests() {
  console.log('--- provider gateway ---');
  const root = await mkdtemp(join(tmpdir(), 'remote-compute-provider-gateway-'));
  const binDir = join(root, 'bin');
  const logPath = join(root, 'colab-args.txt');
  await mkdir(binDir, { recursive: true });

  try {
    const isWindows = process.platform === 'win32';
    const colabPath = join(binDir, isWindows ? 'colab.cmd' : 'colab');
    const script = isWindows
      ? '@echo off\r\necho %* > "%REMOTE_COMPUTE_PROVIDER_LOG%"\r\nexit /b 0\r\n'
      : '#!/bin/sh\nprintf "%s\\n" "$*" > "$REMOTE_COMPUTE_PROVIDER_LOG"\n';
    await writeFile(colabPath, script, 'utf8');
    if (!isWindows) await chmod(colabPath, 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}${delimiter}${process.env.PATH || ''}`,
      PATHEXT: '.CMD;.EXE;.BAT;.COM',
      REMOTE_COMPUTE_PROVIDER_LOG: logPath,
    };

    const result = spawnSync(process.execPath, [BIN, 'colab', 'sessions', '--some-provider-flag', 'value'], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const forwarded = (await readFile(logPath, 'utf8')).trim();
    assert.match(forwarded, /sessions/);
    assert.match(forwarded, /--some-provider-flag/);
    assert.match(forwarded, /value/);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

if (process.argv[1]?.endsWith('provider_gateway.test.mjs')) {
  runProviderGatewayTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

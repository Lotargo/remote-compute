import { resolveClientExecutable, runClientCli } from '../client_cli.mjs';

export function createNativeTransport({
  env = process.env,
  platform = process.platform,
  cwd = process.cwd(),
} = {}) {
  return {
    id: 'native',
    label: 'native',
    platform,
    cwd,
    resolve(command) {
      return resolveClientExecutable(command, { env, platform });
    },
    run(command, args = [], options = {}) {
      return runClientCli(command, args, {
        env,
        platform,
        cwd: options.cwd ?? cwd,
        timeout: options.timeout,
        inherit: options.inherit ?? false,
      });
    },
  };
}

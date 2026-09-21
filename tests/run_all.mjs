import { runClientCliTests } from './client_cli.test.mjs';
import { runColabTransportTests } from './colab_transport.test.mjs';
import { runContractTests } from './contracts.test.mjs';
import { runHostTests } from './hosts.test.mjs';
import { runPlatformTests } from './platform.test.mjs';
import { runProviderGatewayTests } from './provider_gateway.test.mjs';
import { runSkillTests } from './skills.test.mjs';
import { runSetupTests } from './setup.test.mjs';
import { runWslTransportTests } from './wsl_transport.test.mjs';

const suites = [
  ['client_cli', runClientCliTests],
  ['Colab transport', runColabTransportTests],
  ['contracts', runContractTests],
  ['hosts', runHostTests],
  ['platform contracts', runPlatformTests],
  ['provider gateway', runProviderGatewayTests],
  ['skills', runSkillTests],
  ['setup lifecycle', runSetupTests],
  ['WSL transport', runWslTransportTests],
];

let failures = 0;
for (const [name, run] of suites) {
  try {
    await run();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`);
    console.error(error?.stack || error);
  }
}

if (failures > 0) {
  console.error(`\n${failures} test suite(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll local tests passed.');
}

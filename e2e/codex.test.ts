import { describe, it, expect, beforeEach } from 'vitest';
import { useContainer } from '@poe-code/e2e-test-runner';
import { DEFAULT_CODEX_MODEL, stripModelNamespace } from '../src/cli/constants.js';

describe('codex', () => {
  const container = useContainer({ testName: 'codex' });

  beforeEach(async () => {
    const installResult = await container.exec('poe-code install codex');
    expect(installResult).toHaveExitCode(0);
  });

  it('configure and test', async () => {
    const result = await container.exec('poe-code configure codex --yes');
    expect(result).toHaveExitCode(0);

    await expect(container).toHaveFile(`${container.home}/.codex/config.toml`);
    const config = await container.readFile(`${container.home}/.codex/config.toml`);
    expect(config).toContain('model_provider');
    expect(config).toContain(`model = "${stripModelNamespace(DEFAULT_CODEX_MODEL)}"`);
    expect(config).toContain('model_verbosity = "medium"');
    expect(config).toContain('base_url');

    const testResult = await container.exec('poe-code test codex');
    expect(testResult).toSucceedWith('Tested Codex.');
  });

  it('test --isolated', async () => {
    const result = await container.exec('poe-code test codex --isolated');
    expect(result).toSucceedWith('Tested Codex.');
  });
});

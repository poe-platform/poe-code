import { describe, it, expect } from 'bun:test';
import { useContainer } from '@poe-code/e2e-docker-test-runner';

describe('codex', () => {
  const container = useContainer({ testName: 'codex' });

  it('configure and test', async () => {
    const result = await container.exec('poe-code configure codex --yes');
    expect(result).toHaveExitCode(0);

    await expect(container).toHaveFile('/home/poe/.codex/config.toml');
    const config = await container.readFile('/home/poe/.codex/config.toml');
    expect(config).toContain('model_provider');
    expect(config).toContain('model = "gpt-5.4"');
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

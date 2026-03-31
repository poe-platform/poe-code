import { describe, it, expect } from 'bun:test';
import { useContainer } from '@poe-code/e2e-docker-test-runner';

describe('kimi', () => {
  const container = useContainer({ testName: 'kimi' });

  it('configure and test', async () => {
    const result = await container.exec('poe-code configure kimi --yes');
    expect(result).toHaveExitCode(0);

    await expect(container).toHaveFile('/home/poe/.kimi/config.toml');
    const config = await container.readFile('/home/poe/.kimi/config.toml');
    expect(config).toContain('default_model');
    expect(config).toContain('base_url');
    expect(config).toContain('api_key');

    const testResult = await container.exec('poe-code test kimi');
    expect(testResult).toSucceedWith('Tested Kimi.');
  });

  it('test --isolated', async () => {
    const result = await container.exec('poe-code test kimi --isolated');
    expect(result).toSucceedWith('Tested Kimi.');
  });
});

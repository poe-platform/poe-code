import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { useContainer } from '@poe-code/e2e-docker-test-runner';
import { DEFAULT_GOOSE_MODEL } from '../src/cli/constants.js';

describe('goose', () => {
  const container = useContainer({ testName: 'goose' });

  it('install, configure and test', async () => {
    const installResult = await container.exec('poe-code install goose');
    expect(installResult).toHaveExitCode(0);

    const configureResult = await container.exec('poe-code configure goose --yes');
    expect(configureResult).toHaveExitCode(0);

    await expect(container).toHaveFile('/home/poe/.config/goose/config.yaml');
    const config = parseYaml(
      await container.readFile('/home/poe/.config/goose/config.yaml')
    ) as Record<string, unknown>;
    expect(config.GOOSE_PROVIDER).toBe('custom_poe');
    expect(config.GOOSE_MODEL).toBe(DEFAULT_GOOSE_MODEL);

    await expect(container).toHaveFile(
      '/home/poe/.config/goose/custom_providers/custom_poe.json'
    );
    const provider = JSON.parse(
      await container.readFile('/home/poe/.config/goose/custom_providers/custom_poe.json')
    ) as Record<string, unknown>;
    expect(provider.name).toBe('custom_poe');
    expect(provider.api_key_env).toBe('CUSTOM_POE_API_KEY');
    expect(provider.base_url).toBe('https://api.poe.com/v1/chat/completions');
    expect(provider.headers).toHaveProperty('Authorization');

    await expect(container).toHaveFile('/home/poe/.config/goose/secrets.yaml');
    const secrets = parseYaml(
      await container.readFile('/home/poe/.config/goose/secrets.yaml')
    ) as Record<string, unknown>;
    expect(secrets.CUSTOM_POE_API_KEY).toBeTypeOf('string');

    const testResult = await container.exec('env -u POE_API_KEY poe-code test goose');
    expect(testResult).toSucceedWith('Tested Goose.');
  });

  it('test --isolated', async () => {
    const installResult = await container.exec('poe-code install goose');
    expect(installResult).toHaveExitCode(0);

    const result = await container.exec('env -u POE_API_KEY poe-code test goose --isolated');
    expect(result).toSucceedWith('Tested Goose.');

    await expect(container).toHaveFile('/home/poe/.poe-code/goose/.config/goose/secrets.yaml');
    const isolatedSecrets = parseYaml(
      await container.readFile('/home/poe/.poe-code/goose/.config/goose/secrets.yaml')
    ) as Record<string, unknown>;
    expect(isolatedSecrets.CUSTOM_POE_API_KEY).toBeTypeOf('string');
  });
});

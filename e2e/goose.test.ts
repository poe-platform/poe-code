import path from 'path';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { parse as parseYaml } from 'yaml';
import { useContainer } from '@poe-code/e2e-test-runner';
import { DEFAULT_GOOSE_MODEL } from '../src/cli/constants.js';

const bin = path.resolve(__dirname, '..', 'dist', 'bin.cjs');

describe('goose', () => {
  const container = useContainer({ testName: 'goose' });

  beforeAll(() => {
    execSync(`node ${bin} install goose`, { stdio: 'pipe' });
  });

  beforeEach(async () => {
    const installResult = await container.exec('poe-code install goose');
    expect(installResult).toHaveExitCode(0);
  });

  it('configure and test', async () => {
    const configureResult = await container.exec('poe-code configure goose --yes');
    expect(configureResult).toHaveExitCode(0);

    await expect(container).toHaveFile(`${container.home}/.config/goose/config.yaml`);
    const config = parseYaml(
      await container.readFile(`${container.home}/.config/goose/config.yaml`)
    ) as Record<string, unknown>;
    expect(config.GOOSE_PROVIDER).toBe('custom_poe');
    expect(config.GOOSE_MODEL).toBe(DEFAULT_GOOSE_MODEL);

    await expect(container).toHaveFile(
      `${container.home}/.config/goose/custom_providers/custom_poe.json`
    );
    const provider = JSON.parse(
      await container.readFile(`${container.home}/.config/goose/custom_providers/custom_poe.json`)
    ) as Record<string, unknown>;
    expect(provider.name).toBe('custom_poe');
    expect(provider.api_key_env).toBe('CUSTOM_POE_API_KEY');
    expect(provider.base_url).toBe('https://api.poe.com/v1/chat/completions');
    expect(provider.headers).toBeUndefined();

    await expect(container).toHaveFile(`${container.home}/.config/goose/secrets.yaml`);
    const secrets = parseYaml(
      await container.readFile(`${container.home}/.config/goose/secrets.yaml`)
    ) as Record<string, unknown>;
    expect(secrets.CUSTOM_POE_API_KEY).toBeTypeOf('string');

    const testResult = await container.exec('env -u POE_API_KEY poe-code test goose');
    expect(testResult).toSucceedWith('Tested Goose.');
  });

  it('test --isolated', async () => {
    const result = await container.exec('poe-code test goose --isolated');
    expect(result).toSucceedWith('Tested Goose.');

    await expect(container).toHaveFile(`${container.home}/.poe-code/goose/.config/goose/secrets.yaml`);
    const isolatedSecrets = parseYaml(
      await container.readFile(`${container.home}/.poe-code/goose/.config/goose/secrets.yaml`)
    ) as Record<string, unknown>;
    expect(isolatedSecrets.CUSTOM_POE_API_KEY).toBeTypeOf('string');
  });

  it('spawn creates a file', async () => {
    const configureResult = await container.exec('poe-code configure goose --yes');
    expect(configureResult).toHaveExitCode(0);

    const prompt = `Create a file called ${container.workspace}/spawn-test.txt with the exact content: hello`;
    const spawnResult = await container.exec(`poe-code spawn --mode yolo goose "${prompt}"`);
    expect(spawnResult).toHaveExitCode(0);

    await expect(container).toHaveFile(`${container.workspace}/spawn-test.txt`);
    const content = await container.readFile(`${container.workspace}/spawn-test.txt`);
    expect(content).toContain('hello');
  });
});

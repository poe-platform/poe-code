import { describe, it, expect, beforeEach } from 'vitest';
import { useContainer } from '@poe-code/e2e-test-runner';

describe('opencode', () => {
  const container = useContainer({ testName: 'opencode' });

  beforeEach(async () => {
    const installResult = await container.exec('poe-code install opencode');
    expect(installResult).toHaveExitCode(0);
  });

  it('configure and test', async () => {
    const result = await container.exec('poe-code configure opencode --yes');
    expect(result).toHaveExitCode(0);

    await expect(container).toHaveFile(`${container.home}/.config/opencode/config.json`);
    const raw = await container.readFile(`${container.home}/.config/opencode/config.json`);
    const config = JSON.parse(raw);
    expect(config).toHaveProperty('model');
    expect(config).toHaveProperty('enabled_providers');

    await expect(container).toHaveFile(`${container.home}/.local/share/opencode/auth.json`);
    const authRaw = await container.readFile(`${container.home}/.local/share/opencode/auth.json`);
    const auth = JSON.parse(authRaw);
    expect(auth).toHaveProperty('poe.type');
    expect(auth).toHaveProperty('poe.key');

    const testResult = await container.exec('poe-code test opencode');
    expect(testResult).toSucceedWith('Tested OpenCode CLI.');
  });

  it('test --isolated', async () => {
    const result = await container.exec('poe-code test opencode --isolated');
    expect(result).toSucceedWith('Tested OpenCode CLI.');
  });

  it('spawn creates a file', async () => {
    const configResult = await container.exec('poe-code configure opencode --yes');
    expect(configResult).toHaveExitCode(0);

    const prompt = `Create a file called ${container.workspace}/spawn-test.txt with the exact content: hello`;
    const spawnResult = await container.exec(`poe-code spawn --mode yolo opencode "${prompt}"`);
    expect(spawnResult).toHaveExitCode(0);

    await expect(container).toHaveFile(`${container.workspace}/spawn-test.txt`);
    const content = await container.readFile(`${container.workspace}/spawn-test.txt`);
    expect(content).toContain('hello');
  });

  it('spawn creates a file with gpt-5.2', async () => {
    const configResult = await container.exec('poe-code configure opencode --yes');
    expect(configResult).toHaveExitCode(0);

    const prompt = `Create a file called ${container.workspace}/spawn-gpt-test.txt with the exact content: hello`;
    const spawnResult = await container.exec(`poe-code spawn --mode yolo --model openai/gpt-5.2 opencode "${prompt}"`);
    expect(spawnResult).toHaveExitCode(0);

    await expect(container).toHaveFile(`${container.workspace}/spawn-gpt-test.txt`);
    const content = await container.readFile(`${container.workspace}/spawn-gpt-test.txt`);
    expect(content).toContain('hello');
  });
});

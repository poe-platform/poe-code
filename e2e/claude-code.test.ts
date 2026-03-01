import { describe, it, expect } from 'vitest';
import { useContainer } from '@poe-code/e2e-docker-test-runner';

describe('claude-code', () => {
  const container = useContainer({ testName: 'claude-code' });

  it('configure and test', async () => {
    const result = await container.exec('poe-code configure claude-code --yes');
    expect(result).toHaveExitCode(0);

    await expect(container).toHaveFile('/home/poe/.claude/settings.json');
    const raw = await container.readFile('/home/poe/.claude/settings.json');
    const config = JSON.parse(raw);
    expect(config).toHaveProperty('apiKeyHelper');
    expect(config).toHaveProperty('env.ANTHROPIC_BASE_URL');

    const testResult = await container.exec('poe-code test claude-code');
    expect(testResult).toSucceedWith('Tested Claude Code.');
  });

  it('test --isolated', async () => {
    const result = await container.exec('poe-code test claude-code --isolated');
    expect(result).toSucceedWith('Tested Claude Code.');
  });

  it('configure --direct sets Anthropic base URL and removes ANTHROPIC_AUTH_TOKEN', async () => {
    const result = await container.exec(
      'poe-code configure claude-code --direct --api-key sk-ant-fake'
    );
    expect(result).toHaveExitCode(0);

    await expect(container).toHaveFile('/home/poe/.claude/settings.json');
    const raw = await container.readFile('/home/poe/.claude/settings.json');
    const config = JSON.parse(raw);
    expect(config.apiKeyHelper).toBe('echo sk-ant-fake');
    expect(config.env?.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
    expect(config.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(config.model).toBeDefined();
  });
});

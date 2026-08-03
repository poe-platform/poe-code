import { describe, it, expect, beforeEach } from 'vitest';
import { useContainer } from '@poe-code/e2e-test-runner';

describe('claude-code', () => {
  const container = useContainer({ testName: 'claude-code' });

  beforeEach(async () => {
    const installResult = await container.exec('poe-code install claude-code');
    expect(installResult).toHaveExitCode(0);
  });

  it('configure and test', async () => {
    const result = await container.exec('poe-code configure claude-code --yes');
    expect(result).toHaveExitCode(0);

    await expect(container).toHaveFile(`${container.home}/.claude/settings.json`);
    const raw = await container.readFile(`${container.home}/.claude/settings.json`);
    const config = JSON.parse(raw);
    expect(config).not.toHaveProperty('env.ANTHROPIC_CUSTOM_HEADERS');
    expect(config).toHaveProperty('env.ANTHROPIC_BASE_URL');

    const testResult = await container.exec('poe-code test claude-code');
    expect(testResult).toSucceedWith('Tested Claude Code.');
  });

  it('test --isolated', async () => {
    const result = await container.exec('poe-code test claude-code --isolated');
    expect(result).toSucceedWith('Tested Claude Code.');
  });
});

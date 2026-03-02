import { describe, it, expect } from 'vitest';
import { useContainer } from '@poe-code/e2e-docker-test-runner';

describe('doctor', () => {
  const container = useContainer({ testName: 'doctor' });

  it('runs system and auth checks before any agent is configured', async () => {
    const result = await container.exec('poe-code doctor');
    expect(result).toHaveExitCode(0);
    expect(result).toHaveStdout('System');
    expect(result).toHaveStdout('Authentication');
    expect(result).toHaveStdout('Summary');
  });

  it('includes agent checks after configure', async () => {
    await container.execOrThrow('poe-code configure claude-code --yes');

    const result = await container.exec('poe-code doctor');
    expect(result).toHaveExitCode(0);
    expect(result).toHaveStdout('Agent: claude-code');
  });

  it('filters to a single agent', async () => {
    await container.execOrThrow('poe-code configure claude-code --yes');

    const result = await container.exec('poe-code doctor claude-code');
    expect(result).toHaveExitCode(0);
    expect(result).toHaveStdout('claude-code');
  });

  it('shows help text', async () => {
    const result = await container.exec('poe-code doctor --help');
    expect(result).toHaveExitCode(0);
    expect(result).toHaveStdout('Validate Poe configuration and connectivity');
  });
});

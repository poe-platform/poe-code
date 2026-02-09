import { describe, it, expect } from 'vitest';
import { useContainer } from '@poe-code/e2e-docker-test-runner';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');

describe('opencode', () => {
  const container = useContainer({ workspaceDir: repoRoot, testName: 'opencode' });

  it('configure and test', async () => {
    const result = await container.exec('poe-code configure opencode --yes');
    expect(result).toHaveExitCode(0);

    await expect(container).toHaveFile('/home/poe/.config/opencode/config.json');
    const raw = await container.readFile('/home/poe/.config/opencode/config.json');
    const config = JSON.parse(raw);
    expect(config).toHaveProperty('model');
    expect(config).toHaveProperty('enabled_providers');

    await expect(container).toHaveFile('/home/poe/.opencode-data/auth.json');
    const authRaw = await container.readFile('/home/poe/.opencode-data/auth.json');
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
});

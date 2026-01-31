import { describe, it, expect, beforeAll } from 'vitest';
import { runInContainer, setWorkspaceDir, getApiKey } from '@poe-code/e2e-docker-test-runner';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');

beforeAll(() => {
  setWorkspaceDir(repoRoot);
});

function login(): string {
  return `poe-code login --api-key '${getApiKey()}'`;
}

describe('claude-code', () => {
  it('configure flow', () => {
    const result = runInContainer([
      login(),
      'poe-code install claude-code',
      'poe-code configure claude-code --yes',
      'poe-code test claude-code',
    ]);
    expect(result.exitCode).toBe(0);
  });

  it('isolated flow', () => {
    const result = runInContainer([
      login(),
      'poe-code install claude-code',
      'poe-code test claude-code --isolated',
    ]);
    expect(result.exitCode).toBe(0);
  });
});

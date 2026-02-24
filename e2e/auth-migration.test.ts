import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createContainer, setWorkspaceDir } from '@poe-code/e2e-docker-test-runner';
import type { Container } from '@poe-code/e2e-docker-test-runner';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const CREDENTIALS_JSON = '/home/poe/.poe-code/credentials.json';
const CREDENTIALS_ENC = '/home/poe/.poe-code/credentials.enc';

describe('auth migration', () => {
  let container: Container;

  beforeEach(async () => {
    setWorkspaceDir(repoRoot);
    container = await createContainer({ testName: 'auth-migration' });
    // No auto-login — tests control which version performs the login
  });

  afterEach(async () => {
    await container.destroy();
  });

  it('migrates plaintext credentials to encrypted store', async () => {
    // Install old version and login (creates plaintext credentials.json)
    await container.execOrThrow('npm install -g poe-code@3.0.52');
    await container.execOrThrow('poe-code --yes login');

    await expect(container).toHaveFile(CREDENTIALS_JSON);
    const rawBefore = await container.readFile(CREDENTIALS_JSON);
    const credsBefore = JSON.parse(rawBefore);
    expect(credsBefore).toHaveProperty('apiKey');
    expect(typeof credsBefore.apiKey).toBe('string');
    expect(credsBefore.apiKey.length).toBeGreaterThan(0);
    expect(await container.fileExists(CREDENTIALS_ENC)).toBe(false);

    // Re-install local version from the tarball preserved in the image
    await container.execOrThrow('npm install -g /opt/poe-code.tgz');

    // Configure with env var unset so auth store is read, triggering migration
    const result = await container.exec(
      'env -u POE_API_KEY poe-code configure codex --yes'
    );
    expect(result).toHaveExitCode(0);

    // Encrypted credentials file should now exist
    await expect(container).toHaveFile(CREDENTIALS_ENC);

    // Plaintext credentials.json should no longer contain the API key
    const stillExists = await container.fileExists(CREDENTIALS_JSON);
    if (stillExists) {
      const rawAfter = await container.readFile(CREDENTIALS_JSON);
      const credsAfter = JSON.parse(rawAfter);
      expect(credsAfter).not.toHaveProperty('apiKey');
    }
  });
});

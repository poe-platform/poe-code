import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createContainer } from '@poe-code/e2e-docker-test-runner';
import type { Container } from '@poe-code/e2e-docker-test-runner';

const CREDENTIALS_JSON = '/home/poe/.poe-code/credentials.json';
const CREDENTIALS_ENC = '/home/poe/.poe-code/credentials.enc';

describe('auth migration', () => {
  let container: Container;

  beforeEach(async () => {
    container = await createContainer({ testName: 'auth-migration' });
    // No auto-login — tests control which version performs the login
  });

  afterEach(async () => {
    await container.destroy();
  });

  it('migrates plaintext credentials to encrypted store', async () => {
    // Simulate the old plaintext credentials format (as created by poe-code <= 3.0.52)
    await container.execOrThrow('mkdir -p /home/poe/.poe-code');
    await container.execOrThrow(
      `node -e "require('fs').writeFileSync('${CREDENTIALS_JSON}', JSON.stringify({apiKey: process.env.POE_API_KEY}))"`
    );

    await expect(container).toHaveFile(CREDENTIALS_JSON);
    const rawBefore = await container.readFile(CREDENTIALS_JSON);
    const credsBefore = JSON.parse(rawBefore);
    expect(credsBefore).toHaveProperty('apiKey');
    expect(typeof credsBefore.apiKey).toBe('string');
    expect(credsBefore.apiKey.length).toBeGreaterThan(0);
    expect(await container.fileExists(CREDENTIALS_ENC)).toBe(false);

    // Login with current version — reads API key from env and stores in encrypted store
    await container.execOrThrow('poe-code --yes login');

    // Encrypted credentials file should now exist
    await expect(container).toHaveFile(CREDENTIALS_ENC);

    // Configure with env var unset so auth store is read from encrypted store
    const result = await container.exec(
      'env -u POE_API_KEY poe-code configure codex --yes'
    );
    expect(result).toHaveExitCode(0);

    // Plaintext credentials.json should no longer contain the API key (migrated by config loader)
    const stillExists = await container.fileExists(CREDENTIALS_JSON);
    if (stillExists) {
      const rawAfter = await container.readFile(CREDENTIALS_JSON);
      const credsAfter = JSON.parse(rawAfter);
      expect(credsAfter).not.toHaveProperty('apiKey');
    }
  });
});

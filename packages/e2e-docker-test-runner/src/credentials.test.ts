import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import { homedir } from 'node:os';

vi.mock('node:fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});

describe('credentials', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vol.reset();
    process.env = { ...originalEnv };
    delete process.env.POE_API_KEY;
    delete process.env.POE_CODE_API_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns POE_API_KEY from environment', async () => {
    process.env.POE_API_KEY = 'env-key';
    const { getApiKey } = await import('./credentials.js');
    expect(getApiKey()).toBe('env-key');
  });

  it('returns POE_CODE_API_KEY from environment', async () => {
    process.env.POE_CODE_API_KEY = 'code-key';
    const { getApiKey } = await import('./credentials.js');
    expect(getApiKey()).toBe('code-key');
  });

  it('prefers POE_API_KEY over POE_CODE_API_KEY', async () => {
    process.env.POE_API_KEY = 'poe-key';
    process.env.POE_CODE_API_KEY = 'code-key';
    const { getApiKey } = await import('./credentials.js');
    expect(getApiKey()).toBe('poe-key');
  });

  it('reads from credentials file when env not set', async () => {
    const credPath = `${homedir()}/.poe-code/credentials.json`;
    vol.fromJSON({
      [credPath]: JSON.stringify({ apiKey: 'file-key' }),
    });
    const { getApiKey } = await import('./credentials.js');
    expect(getApiKey()).toBe('file-key');
  });

  it('returns null when no credentials found', async () => {
    const { getApiKey } = await import('./credentials.js');
    expect(getApiKey()).toBeNull();
  });

  it('returns null for invalid JSON in credentials file', async () => {
    const credPath = `${homedir()}/.poe-code/credentials.json`;
    vol.fromJSON({
      [credPath]: 'not valid json',
    });
    const { getApiKey } = await import('./credentials.js');
    expect(getApiKey()).toBeNull();
  });

  it('returns null when credentials file has no apiKey', async () => {
    const credPath = `${homedir()}/.poe-code/credentials.json`;
    vol.fromJSON({
      [credPath]: JSON.stringify({ otherField: 'value' }),
    });
    const { getApiKey } = await import('./credentials.js');
    expect(getApiKey()).toBeNull();
  });

  describe('hasApiKey', () => {
    it('returns true when API key exists', async () => {
      process.env.POE_API_KEY = 'some-key';
      const { hasApiKey } = await import('./credentials.js');
      expect(hasApiKey()).toBe(true);
    });

    it('returns false when no API key', async () => {
      const { hasApiKey } = await import('./credentials.js');
      expect(hasApiKey()).toBe(false);
    });
  });
});

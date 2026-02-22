import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import { homedir } from 'node:os';

const VALID_API_KEY = 'vnlaoHCddCx7eAGLgdH4iS-g_1MYPsg0JnTRPF1qMuo';
const TOO_SHORT_API_KEY = 'sk-poe-abc123';

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

  it('trims whitespace around environment key', async () => {
    process.env.POE_API_KEY = `  ${VALID_API_KEY}  `;
    const { getApiKey } = await import('./credentials.js');
    expect(getApiKey()).toBe(VALID_API_KEY);
  });

  it('does not use POE_CODE_API_KEY fallback', async () => {
    process.env.POE_CODE_API_KEY = 'legacy-code-key';
    const { getApiKey } = await import('./credentials.js');
    expect(getApiKey()).toBeNull();
  });

  it('uses POE_API_KEY when both env vars are set', async () => {
    process.env.POE_API_KEY = 'poe-key';
    process.env.POE_CODE_API_KEY = 'legacy-code-key';
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

  describe('resolveApiKey', () => {
    it('returns key source and format validity for env keys', async () => {
      process.env.POE_API_KEY = VALID_API_KEY;
      const { resolveApiKey } = await import('./credentials.js');
      expect(resolveApiKey()).toEqual({
        key: VALID_API_KEY,
        source: 'POE_API_KEY',
        valid: true,
      });
    });

    it('marks short keys as invalid format', async () => {
      process.env.POE_API_KEY = TOO_SHORT_API_KEY;
      const { resolveApiKey } = await import('./credentials.js');
      expect(resolveApiKey()).toEqual({
        key: TOO_SHORT_API_KEY,
        source: 'POE_API_KEY',
        valid: false,
      });
    });

    it('returns credentials as source when loaded from file', async () => {
      const credPath = `${homedir()}/.poe-code/credentials.json`;
      vol.fromJSON({
        [credPath]: JSON.stringify({ apiKey: VALID_API_KEY }),
      });
      const { resolveApiKey } = await import('./credentials.js');
      expect(resolveApiKey()).toEqual({
        key: VALID_API_KEY,
        source: 'credentials',
        valid: true,
      });
    });
  });

  describe('hasValidApiKey', () => {
    it('returns true for valid key', async () => {
      process.env.POE_API_KEY = VALID_API_KEY;
      const { hasValidApiKey } = await import('./credentials.js');
      expect(hasValidApiKey()).toBe(true);
    });

    it('returns false for invalid key format', async () => {
      process.env.POE_API_KEY = TOO_SHORT_API_KEY;
      const { hasValidApiKey } = await import('./credentials.js');
      expect(hasValidApiKey()).toBe(false);
    });
  });

  describe('isValidApiKeyFormat', () => {
    it('accepts keys with hyphens and underscores', async () => {
      const { isValidApiKeyFormat } = await import('./credentials.js');
      expect(isValidApiKeyFormat(VALID_API_KEY)).toBe(true);
    });

    it('rejects short sk-poe keys', async () => {
      const { isValidApiKeyFormat } = await import('./credentials.js');
      expect(isValidApiKeyFormat(TOO_SHORT_API_KEY)).toBe(false);
    });
  });
});

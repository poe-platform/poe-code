import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const getApiKeyFromStore = vi.fn<() => Promise<string | null>>();
const createAuthStoreMock = vi.fn(() => ({
  backend: 'file' as const,
  store: {
    getApiKey: getApiKeyFromStore,
    setApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
  },
}));

vi.mock('@poe-code/auth', () => ({
  createAuthStore: createAuthStoreMock,
}));

describe('credentials', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.POE_API_KEY;
    getApiKeyFromStore.mockReset();
    getApiKeyFromStore.mockResolvedValue(null);
    createAuthStoreMock.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns POE_API_KEY from environment', async () => {
    process.env.POE_API_KEY = 'env-key';
    const { getApiKey } = await import('./credentials.js');
    await expect(getApiKey()).resolves.toBe('env-key');
    expect(createAuthStoreMock).not.toHaveBeenCalled();
  });

  it('uses POE_API_KEY when present', async () => {
    process.env.POE_API_KEY = 'poe-key';
    const { getApiKey } = await import('./credentials.js');
    await expect(getApiKey()).resolves.toBe('poe-key');
    expect(createAuthStoreMock).not.toHaveBeenCalled();
  });

  it('ignores deprecated env key name and reads from auth store', async () => {
    const deprecatedEnvKeyName = ['POE', 'CODE', 'API', 'KEY'].join('_');
    process.env[deprecatedEnvKeyName] = 'deprecated-key';
    getApiKeyFromStore.mockResolvedValue('stored-key');

    const { getApiKey } = await import('./credentials.js');
    await expect(getApiKey()).resolves.toBe('stored-key');
    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
  });

  it('reads from auth store when env is not set', async () => {
    getApiKeyFromStore.mockResolvedValue('stored-key');
    const { getApiKey } = await import('./credentials.js');
    await expect(getApiKey()).resolves.toBe('stored-key');
    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when no credentials found', async () => {
    const { getApiKey } = await import('./credentials.js');
    await expect(getApiKey()).resolves.toBeNull();
  });

  it('returns null when auth store throws', async () => {
    getApiKeyFromStore.mockRejectedValue(new Error('store unavailable'));
    const { getApiKey } = await import('./credentials.js');
    await expect(getApiKey()).resolves.toBeNull();
  });

  it('returns trimmed key from auth store', async () => {
    getApiKeyFromStore.mockResolvedValue('  stored-trimmed  ');
    const { getApiKey } = await import('./credentials.js');
    await expect(getApiKey()).resolves.toBe('stored-trimmed');
  });

  describe('hasApiKey', () => {
    it('returns true when API key exists', async () => {
      process.env.POE_API_KEY = 'some-key';
      const { hasApiKey } = await import('./credentials.js');
      await expect(hasApiKey()).resolves.toBe(true);
    });

    it('returns false when no API key', async () => {
      const { hasApiKey } = await import('./credentials.js');
      await expect(hasApiKey()).resolves.toBe(false);
    });
  });
});

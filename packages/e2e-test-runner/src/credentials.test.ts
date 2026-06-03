import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createSecretStoreMock = vi.hoisted(() => vi.fn());

vi.mock('auth-store', () => ({
  createSecretStore: createSecretStoreMock,
}));

describe('getApiKey', () => {
  const originalApiKey = process.env.POE_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    createSecretStoreMock.mockReset();
    delete process.env.POE_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.POE_API_KEY;
    } else {
      process.env.POE_API_KEY = originalApiKey;
    }
  });

  it('caches an env API key for later lookups in the same process', async () => {
    process.env.POE_API_KEY = 'sk-env';
    const credentials = await import('./credentials.js');

    await expect(credentials.getApiKey()).resolves.toBe('sk-env');

    delete process.env.POE_API_KEY;
    await expect(credentials.getApiKey()).resolves.toBe('sk-env');
    expect(createSecretStoreMock).not.toHaveBeenCalled();
  });

  it('re-reads a stored API key so credential removal takes effect', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce('sk-stored')
      .mockResolvedValueOnce(null);
    createSecretStoreMock.mockReturnValue({
      store: {
        get,
      },
    });
    const credentials = await import('./credentials.js');

    await expect(credentials.getApiKey()).resolves.toBe('sk-stored');
    await expect(credentials.getApiKey()).resolves.toBeNull();
    expect(createSecretStoreMock).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

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

  it('does not reuse an env API key after the environment removes it', async () => {
    process.env.POE_API_KEY = 'sk-env';
    const credentials = await import('./credentials.js');

    await expect(credentials.getApiKey()).resolves.toBe('sk-env');

    delete process.env.POE_API_KEY;
    createSecretStoreMock.mockReturnValue({
      store: {
        get: vi.fn(async () => null),
      },
    });

    await expect(credentials.getApiKey()).resolves.toBeNull();
    expect(createSecretStoreMock).toHaveBeenCalledTimes(2);
  });

  it('ignores a previously cached env API key when the current env value is blank', async () => {
    process.env.POE_API_KEY = 'sk-env';
    const credentials = await import('./credentials.js');

    await expect(credentials.getApiKey()).resolves.toBe('sk-env');

    process.env.POE_API_KEY = '   ';
    createSecretStoreMock.mockReturnValue({
      store: {
        get: vi.fn(async () => null),
      },
    });

    await expect(credentials.getApiKey()).resolves.toBeNull();
    expect(createSecretStoreMock).toHaveBeenCalledTimes(2);
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
    expect(createSecretStoreMock).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('prefers the current Poe provider credential over the legacy credential', async () => {
    createSecretStoreMock.mockImplementation(({ fileStore }) => ({
      store: {
        get: vi.fn(async () =>
          fileStore.defaultFileName === 'credentials.poe.enc' ? 'sk-current' : 'sk-revoked'
        ),
      },
    }));
    const credentials = await import('./credentials.js');

    await expect(credentials.getApiKey()).resolves.toBe('sk-current');
    expect(createSecretStoreMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileStore: expect.objectContaining({ defaultFileName: 'credentials.poe.enc' }),
      }),
    );
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const createAuthStoreMock = vi.hoisted(() => vi.fn());

describe("getPoeApiKey", () => {
  let originalEnv: NodeJS.ProcessEnv;
  const store = {
    getApiKey: vi.fn<() => Promise<string | null>>(),
    setApiKey: vi.fn<() => Promise<void>>(),
    deleteApiKey: vi.fn<() => Promise<void>>()
  };

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.POE_API_KEY;

    vi.resetModules();
    vi.doMock("@poe-code/poe-auth", () => ({
      createAuthStore: createAuthStoreMock
    }));

    createAuthStoreMock.mockReset();
    store.getApiKey.mockReset();
    store.setApiKey.mockReset();
    store.deleteApiKey.mockReset();
    createAuthStoreMock.mockReturnValue({
      backend: "file",
      store
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns POE_API_KEY from environment variable when set", async () => {
    process.env.POE_API_KEY = "env-api-key-123";

    const { getPoeApiKey } = await import("./credentials.js");
    const result = await getPoeApiKey();
    expect(result).toBe("env-api-key-123");
    expect(createAuthStoreMock).not.toHaveBeenCalled();
  });

  it("trims whitespace from environment variable", async () => {
    process.env.POE_API_KEY = "  trimmed-key  ";

    const { getPoeApiKey } = await import("./credentials.js");
    const result = await getPoeApiKey();
    expect(result).toBe("trimmed-key");
    expect(createAuthStoreMock).not.toHaveBeenCalled();
  });

  it("returns key from auth store when environment variable is missing", async () => {
    delete process.env.POE_API_KEY;
    store.getApiKey.mockResolvedValue("auth-store-key");

    const { getPoeApiKey } = await import("./credentials.js");
    const result = await getPoeApiKey();

    expect(result).toBe("auth-store-key");
    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(store.getApiKey).toHaveBeenCalledTimes(1);
  });

  it("uses auth store when POE_API_KEY is empty", async () => {
    process.env.POE_API_KEY = "";
    store.getApiKey.mockResolvedValue("fallback-key");

    const { getPoeApiKey } = await import("./credentials.js");
    const result = await getPoeApiKey();

    expect(result).toBe("fallback-key");
    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(store.getApiKey).toHaveBeenCalledTimes(1);
  });

  it("uses auth store when POE_API_KEY is whitespace-only", async () => {
    process.env.POE_API_KEY = "   ";
    store.getApiKey.mockResolvedValue("fallback-key");

    const { getPoeApiKey } = await import("./credentials.js");
    const result = await getPoeApiKey();

    expect(result).toBe("fallback-key");
    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(store.getApiKey).toHaveBeenCalledTimes(1);
  });

  it("throws error when neither env nor auth store has a key", async () => {
    delete process.env.POE_API_KEY;
    store.getApiKey.mockResolvedValue(null);

    const { getPoeApiKey } = await import("./credentials.js");
    await expect(getPoeApiKey()).rejects.toThrow(
      "No API key found. Set POE_API_KEY or run 'poe-code login'."
    );
    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(store.getApiKey).toHaveBeenCalledTimes(1);
  });
});

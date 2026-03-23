import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const createSecretStoreMock = vi.hoisted(() => vi.fn());

describe("getPoeApiKey", () => {
  let originalEnv: NodeJS.ProcessEnv;
  const store = {
    get: vi.fn<() => Promise<string | null>>(),
    set: vi.fn<() => Promise<void>>(),
    delete: vi.fn<() => Promise<void>>()
  };

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.POE_API_KEY;

    vi.resetModules();
    vi.doMock("auth-store", () => ({
      createSecretStore: createSecretStoreMock
    }));

    createSecretStoreMock.mockReset();
    store.get.mockReset();
    store.set.mockReset();
    store.delete.mockReset();
    createSecretStoreMock.mockReturnValue({
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
    expect(createSecretStoreMock).not.toHaveBeenCalled();
  });

  it("trims whitespace from environment variable", async () => {
    process.env.POE_API_KEY = "  trimmed-key  ";

    const { getPoeApiKey } = await import("./credentials.js");
    const result = await getPoeApiKey();
    expect(result).toBe("trimmed-key");
    expect(createSecretStoreMock).not.toHaveBeenCalled();
  });

  it("returns key from auth store when environment variable is missing", async () => {
    delete process.env.POE_API_KEY;
    store.get.mockResolvedValue("auth-store-key");

    const { getPoeApiKey } = await import("./credentials.js");
    const result = await getPoeApiKey();

    expect(result).toBe("auth-store-key");
    expect(createSecretStoreMock).toHaveBeenCalledTimes(1);
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("uses auth store when POE_API_KEY is empty", async () => {
    process.env.POE_API_KEY = "";
    store.get.mockResolvedValue("fallback-key");

    const { getPoeApiKey } = await import("./credentials.js");
    const result = await getPoeApiKey();

    expect(result).toBe("fallback-key");
    expect(createSecretStoreMock).toHaveBeenCalledTimes(1);
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("uses auth store when POE_API_KEY is whitespace-only", async () => {
    process.env.POE_API_KEY = "   ";
    store.get.mockResolvedValue("fallback-key");

    const { getPoeApiKey } = await import("./credentials.js");
    const result = await getPoeApiKey();

    expect(result).toBe("fallback-key");
    expect(createSecretStoreMock).toHaveBeenCalledTimes(1);
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("throws error when neither env nor auth store has a key", async () => {
    delete process.env.POE_API_KEY;
    store.get.mockResolvedValue(null);

    const { getPoeApiKey } = await import("./credentials.js");
    await expect(getPoeApiKey()).rejects.toThrow(
      "No API key found. Set POE_API_KEY or run 'poe-code login'."
    );
    expect(createSecretStoreMock).toHaveBeenCalledTimes(1);
    expect(store.get).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test";
import * as authStoreModule from "auth-store";
import { getPoeApiKey } from "./credentials.js";

describe("getPoeApiKey", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let createSecretStoreSpy: ReturnType<typeof vi.spyOn>;
  const store = {
    get: vi.fn<() => Promise<string | null>>(),
    set: vi.fn<() => Promise<void>>(),
    delete: vi.fn<() => Promise<void>>()
  };

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.POE_API_KEY;

    createSecretStoreSpy = vi.spyOn(authStoreModule, "createSecretStore" as any).mockReturnValue({
      backend: "file",
      store
    });

    store.get.mockReset();
    store.set.mockReset();
    store.delete.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    createSecretStoreSpy?.mockRestore();
  });

  it("returns POE_API_KEY from environment variable when set", async () => {
    process.env.POE_API_KEY = "env-api-key-123";

    const result = await getPoeApiKey();
    expect(result).toBe("env-api-key-123");
    expect(createSecretStoreSpy).not.toHaveBeenCalled();
  });

  it("trims whitespace from environment variable", async () => {
    process.env.POE_API_KEY = "  trimmed-key  ";

    const result = await getPoeApiKey();
    expect(result).toBe("trimmed-key");
    expect(createSecretStoreSpy).not.toHaveBeenCalled();
  });

  it("returns key from auth store when environment variable is missing", async () => {
    delete process.env.POE_API_KEY;
    store.get.mockResolvedValue("auth-store-key");

    const result = await getPoeApiKey();

    expect(result).toBe("auth-store-key");
    expect(createSecretStoreSpy).toHaveBeenCalledTimes(1);
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("uses auth store when POE_API_KEY is empty", async () => {
    process.env.POE_API_KEY = "";
    store.get.mockResolvedValue("fallback-key");

    const result = await getPoeApiKey();

    expect(result).toBe("fallback-key");
    expect(createSecretStoreSpy).toHaveBeenCalledTimes(1);
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("uses auth store when POE_API_KEY is whitespace-only", async () => {
    process.env.POE_API_KEY = "   ";
    store.get.mockResolvedValue("fallback-key");

    const result = await getPoeApiKey();

    expect(result).toBe("fallback-key");
    expect(createSecretStoreSpy).toHaveBeenCalledTimes(1);
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("throws error when neither env nor auth store has a key", async () => {
    delete process.env.POE_API_KEY;
    store.get.mockResolvedValue(null);

    await expect(getPoeApiKey()).rejects.toThrow(
      "No API key found. Set POE_API_KEY or run 'poe-code login'."
    );
    expect(createSecretStoreSpy).toHaveBeenCalledTimes(1);
    expect(store.get).toHaveBeenCalledTimes(1);
  });
});

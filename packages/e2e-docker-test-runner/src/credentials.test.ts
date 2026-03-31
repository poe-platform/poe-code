import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";

const getFromStore = vi.fn<() => Promise<string | null>>();
const createSecretStoreMock = vi.fn(() => ({
  backend: "file" as const,
  store: {
    get: getFromStore,
    set: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("credentials", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mock.restore();
    createSecretStoreMock.mockReset();
    createSecretStoreMock.mockImplementation(() => ({
      backend: "file" as const,
      store: {
        get: getFromStore,
        set: vi.fn(),
        delete: vi.fn(),
      },
    }));
    mock.module("auth-store", () => ({
      createSecretStore: createSecretStoreMock,
    }));
    process.env = { ...originalEnv };
    delete process.env.POE_API_KEY;
    getFromStore.mockReset();
    getFromStore.mockResolvedValue(null);
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns POE_API_KEY from environment", async () => {
    process.env.POE_API_KEY = "env-key";
    const { getApiKey } = await import("./credentials.ts");
    await expect(getApiKey()).resolves.toBe("env-key");
    expect(createSecretStoreMock).not.toHaveBeenCalled();
  });

  it("uses POE_API_KEY when present", async () => {
    process.env.POE_API_KEY = "poe-key";
    const { getApiKey } = await import("./credentials.ts");
    await expect(getApiKey()).resolves.toBe("poe-key");
    expect(createSecretStoreMock).not.toHaveBeenCalled();
  });

  it("ignores deprecated env key name and reads from auth store", async () => {
    const deprecatedEnvKeyName = ["POE", "CODE", "API", "KEY"].join("_");
    process.env[deprecatedEnvKeyName] = "deprecated-key";
    getFromStore.mockResolvedValue("stored-key");

    const { getApiKey } = await import("./credentials.ts");
    await expect(getApiKey()).resolves.toBe("stored-key");
    expect(createSecretStoreMock).toHaveBeenCalledTimes(1);
  });

  it("reads from auth store when env is not set", async () => {
    getFromStore.mockResolvedValue("stored-key");
    const { getApiKey } = await import("./credentials.ts");
    await expect(getApiKey()).resolves.toBe("stored-key");
    expect(createSecretStoreMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when no credentials found", async () => {
    const { getApiKey } = await import("./credentials.ts");
    await expect(getApiKey()).resolves.toBeNull();
  });

  it("returns null when auth store throws", async () => {
    createSecretStoreMock.mockImplementation(() => {
      throw new Error("store unavailable");
    });
    const { getApiKey } = await import("./credentials.ts");
    await expect(getApiKey()).resolves.toBeNull();
  });

  it("returns trimmed key from auth store", async () => {
    getFromStore.mockResolvedValue("  stored-trimmed  ");
    const { getApiKey } = await import("./credentials.ts");
    await expect(getApiKey()).resolves.toBe("stored-trimmed");
  });

  describe("hasApiKey", () => {
    it("returns true when API key exists", async () => {
      process.env.POE_API_KEY = "some-key";
      const { hasApiKey } = await import("./credentials.ts");
      await expect(hasApiKey()).resolves.toBe(true);
    });

    it("returns false when no API key", async () => {
      const { hasApiKey } = await import("./credentials.ts");
      await expect(hasApiKey()).resolves.toBe(false);
    });
  });
});

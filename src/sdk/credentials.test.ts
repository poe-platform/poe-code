import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const createSecretStoreMock = vi.hoisted(() => vi.fn());

vi.mock("ts-morph", () => {
  throw new Error("Runtime credentials must not load the schema compiler");
});

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

  it("leaves an exported key untouched when ensuring POE_API_KEY", async () => {
    process.env.POE_API_KEY = "  env-key  ";

    const { ensurePoeApiKeyEnv } = await import("./credentials.js");
    await ensurePoeApiKeyEnv();

    expect(process.env.POE_API_KEY).toBe("  env-key  ");
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

  it("ignores an inherited POE_API_KEY", async () => {
    Object.defineProperty(Object.prototype, "POE_API_KEY", {
      configurable: true,
      value: "inherited-key"
    });
    store.get.mockResolvedValue("auth-store-key");

    try {
      const { getPoeApiKey } = await import("./credentials.js");
      await expect(getPoeApiKey()).resolves.toBe("auth-store-key");
    } finally {
      delete (Object.prototype as { POE_API_KEY?: string }).POE_API_KEY;
    }
  });

  it("exports the auth-store key when ensuring POE_API_KEY", async () => {
    delete process.env.POE_API_KEY;
    store.get.mockResolvedValue("  auth-store-key  ");

    const { ensurePoeApiKeyEnv } = await import("./credentials.js");
    await ensurePoeApiKeyEnv();

    expect(process.env.POE_API_KEY).toBe("auth-store-key");
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

  it("throws a typed user-facing AuthenticationError when no key is found", async () => {
    delete process.env.POE_API_KEY;
    store.get.mockResolvedValue(null);

    const { getPoeApiKey } = await import("./credentials.js");
    const { AuthenticationError } = await import("../cli/errors.js");

    await expect(getPoeApiKey()).rejects.toBeInstanceOf(AuthenticationError);
    await expect(getPoeApiKey()).rejects.toMatchObject({
      name: "AuthenticationError",
      isUserError: true
    });
  });

  it("fetches Poe auth identity with an explicit API key", async () => {
    const httpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: 42,
        handle: "sdk",
        name: "SDK User",
        profile_picture: "https://example.com/sdk.jpg",
        plan: "extra-field"
      })
    }));

    const { getPoeAuthIdentity } = await import("./credentials.js");
    const identity = await getPoeAuthIdentity({ apiKey: "direct-key", httpClient });

    expect(identity).toEqual({
      user_id: 42,
      handle: "sdk",
      name: "SDK User",
      profile_picture: "https://example.com/sdk.jpg",
      plan: "extra-field"
    });
    expect(httpClient).toHaveBeenCalledWith(
      "https://api.poe.com/v1/whoami",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer direct-key" })
      })
    );
    expect(createSecretStoreMock).not.toHaveBeenCalled();
  });

  it("uses stored credentials and normalized POE_BASE_URL when fetching auth identity", async () => {
    process.env.POE_BASE_URL = "https://proxy.example.com";
    store.get.mockResolvedValue("stored-key");
    const httpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: 7,
        handle: "stored",
        name: "Stored User",
        profile_picture: ""
      })
    }));

    const { getPoeAuthIdentity } = await import("./credentials.js");
    await getPoeAuthIdentity({ httpClient });

    expect(httpClient).toHaveBeenCalledWith(
      "https://proxy.example.com/v1/whoami",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer stored-key" })
      })
    );
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("throws ApiError when auth identity lookup fails", async () => {
    const httpClient = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({})
    }));

    const { fetchPoeAuthIdentity } = await import("./credentials.js");

    await expect(
      fetchPoeAuthIdentity({ apiKey: "bad-key", httpClient })
    ).rejects.toMatchObject({
      name: "ApiError",
      message: "Failed to fetch identity (HTTP 401)",
      httpStatus: 401,
      endpoint: "/v1/whoami"
    });
  });

  it("throws ApiError when auth identity response is malformed", async () => {
    const httpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: "not-a-number",
        handle: "   ",
        name: "",
        profile_picture: 123
      })
    }));

    const { fetchPoeAuthIdentity } = await import("./credentials.js");

    await expect(
      fetchPoeAuthIdentity({ apiKey: "test-key", httpClient })
    ).rejects.toMatchObject({
      name: "ApiError",
      message: "Malformed identity response from Poe API.",
      endpoint: "/v1/whoami"
    });
  });
});

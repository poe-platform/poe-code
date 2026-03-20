import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiKeyMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
const createAuthStoreMock = vi.hoisted(() =>
  vi.fn(() => ({
    backend: "file" as const,
    store: {
      getApiKey: getApiKeyMock
    }
  }))
);

vi.mock("./create-auth-store.js", () => ({
  createAuthStore: createAuthStoreMock
}));

async function loadGetToken() {
  return await import("./get-token.js");
}

describe("getToken", () => {
  beforeEach(() => {
    vi.resetModules();
    getApiKeyMock.mockReset();
    getApiKeyMock.mockResolvedValue(null);
    createAuthStoreMock.mockClear();
  });

  it("returns the stored api key", async () => {
    const { getToken } = await loadGetToken();

    getApiKeyMock.mockResolvedValue("stored-key");

    await expect(getToken()).resolves.toBe("stored-key");

    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(getApiKeyMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when no api key is stored", async () => {
    const { getToken } = await loadGetToken();

    await expect(getToken()).resolves.toBeNull();

    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(getApiKeyMock).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh auth store for each call", async () => {
    const { getToken } = await loadGetToken();

    await expect(getToken()).resolves.toBeNull();
    await expect(getToken()).resolves.toBeNull();

    expect(createAuthStoreMock).toHaveBeenCalledTimes(2);
    expect(getApiKeyMock).toHaveBeenCalledTimes(2);
  });

  it("rejects when creating the auth store fails", async () => {
    const { getToken } = await loadGetToken();
    const error = new Error("store unavailable");

    createAuthStoreMock.mockImplementationOnce(() => {
      throw error;
    });

    await expect(getToken()).rejects.toThrow("store unavailable");

    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(getApiKeyMock).not.toHaveBeenCalled();
  });

  it("rethrows store read errors", async () => {
    const { getToken } = await loadGetToken();
    const error = new Error("read failed");

    getApiKeyMock.mockRejectedValue(error);

    await expect(getToken()).rejects.toThrow("read failed");

    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(getApiKeyMock).toHaveBeenCalledTimes(1);
  });
});

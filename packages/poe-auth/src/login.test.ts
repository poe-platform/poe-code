import { beforeEach, describe, expect, it, vi } from "vitest";

const setApiKeyMock = vi.hoisted(() => vi.fn<(apiKey: string) => Promise<void>>());
const authorizeMock = vi.hoisted(() =>
  vi.fn<() => Promise<{ waitForResult: () => Promise<{ apiKey: string }> }>>()
);
const createAuthStoreMock = vi.hoisted(() =>
  vi.fn(() => ({
    backend: "file" as const,
    store: {
      setApiKey: setApiKeyMock
    }
  }))
);
const createOAuthClientMock = vi.hoisted(() =>
  vi.fn(() => ({
    authorize: authorizeMock
  }))
);

vi.mock("./create-auth-store.js", () => ({
  createAuthStore: createAuthStoreMock
}));

vi.mock("./oauth-client.js", () => ({
  createOAuthClient: createOAuthClientMock
}));

async function loadLogin() {
  return await import("./login.js");
}

describe("login", () => {
  beforeEach(() => {
    vi.resetModules();
    setApiKeyMock.mockReset();
    setApiKeyMock.mockResolvedValue(undefined);
    authorizeMock.mockReset();
    createAuthStoreMock.mockClear();
    createOAuthClientMock.mockClear();
  });

  it("stores and returns a provided api key when valid", async () => {
    const { login } = await loadLogin();
    const apiKey = "sk-poe-abcdefghijklmnopqrstuvwxyz12345678";

    await expect(login({ apiKey })).resolves.toBe(apiKey);

    expect(createOAuthClientMock).not.toHaveBeenCalled();
    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(setApiKeyMock).toHaveBeenCalledWith(apiKey);
  });

  it("throws when provided api key format is invalid", async () => {
    const { login } = await loadLogin();

    await expect(login({ apiKey: "not-a-valid-key" })).rejects.toThrow(
      "POE API key format is invalid."
    );

    expect(createAuthStoreMock).not.toHaveBeenCalled();
    expect(createOAuthClientMock).not.toHaveBeenCalled();
  });

  it("runs OAuth login, stores the returned key, and passes through helpers", async () => {
    const { login } = await loadLogin();
    const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const readLine = vi.fn<() => Promise<string>>().mockResolvedValue("callback");
    const apiKey = "sk-poe-abcdefghijklmnopqrstuvwxyz12345678";
    const waitForResult = vi.fn<() => Promise<{ apiKey: string }>>().mockResolvedValue({ apiKey });

    authorizeMock.mockResolvedValue({ waitForResult });

    await expect(login({ openBrowser, readLine })).resolves.toBe(apiKey);

    expect(createOAuthClientMock).toHaveBeenCalledWith({
      clientId: "client_f520ee4d8ca84a13ba876a8731d264d0",
      authorizationEndpoint: "https://poe.com/oauth/authorize",
      tokenEndpoint: "https://api.poe.com/token",
      openBrowser,
      readLine
    });
    expect(authorizeMock).toHaveBeenCalledTimes(1);
    expect(waitForResult).toHaveBeenCalledTimes(1);
    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(setApiKeyMock).toHaveBeenCalledWith(apiKey);
  });

  it("rethrows OAuth errors without storing a key", async () => {
    const { login } = await loadLogin();
    const error = new Error("authorization failed");

    authorizeMock.mockRejectedValue(error);

    await expect(login()).rejects.toThrow("authorization failed");

    expect(createOAuthClientMock).toHaveBeenCalledTimes(1);
    expect(createAuthStoreMock).not.toHaveBeenCalled();
    expect(setApiKeyMock).not.toHaveBeenCalled();
  });
});

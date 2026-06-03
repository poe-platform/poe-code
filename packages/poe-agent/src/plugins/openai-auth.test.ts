import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeGetMock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>());
const createSecretStoreMock = vi.hoisted(() =>
  vi.fn(() => ({
    store: {
      get: storeGetMock
    }
  }))
);

vi.mock("auth-store", () => ({
  createSecretStore: createSecretStoreMock
}));

import { resolveOpenaiApiKey } from "./openai-auth.js";

describe("resolveOpenaiApiKey", () => {
  const originalPoeApiKey = process.env.POE_API_KEY;

  beforeEach(() => {
    delete process.env.POE_API_KEY;
    createSecretStoreMock.mockClear();
    storeGetMock.mockReset();
  });

  afterEach(() => {
    if (originalPoeApiKey === undefined) {
      delete process.env.POE_API_KEY;
    } else {
      process.env.POE_API_KEY = originalPoeApiKey;
    }
  });

  it("returns the explicit api key without consulting auth-store", async () => {
    await expect(resolveOpenaiApiKey("test-key")).resolves.toBe("test-key");

    expect(createSecretStoreMock).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only explicit api key as missing and falls back to auth-store", async () => {
    storeGetMock.mockResolvedValue("stored-key");

    await expect(resolveOpenaiApiKey("   ")).resolves.toBe("stored-key");

    expect(createSecretStoreMock).toHaveBeenCalledOnce();
  });

  it("loads the api key from auth-store when explicit api key is omitted", async () => {
    storeGetMock.mockResolvedValue("stored-key");

    await expect(resolveOpenaiApiKey(undefined)).resolves.toBe("stored-key");

    expect(createSecretStoreMock).toHaveBeenCalledWith({
      backendEnvVar: "POE_AUTH_BACKEND",
      fileStore: {
        salt: "poe-code:encrypted-file-auth-store:v1",
        defaultDirectory: ".poe-code",
        defaultFileName: "credentials.enc"
      }
    });
  });

  it("uses POE_API_KEY before consulting auth-store", async () => {
    process.env.POE_API_KEY = "environment-key";

    await expect(resolveOpenaiApiKey(undefined)).resolves.toBe("environment-key");
    expect(createSecretStoreMock).not.toHaveBeenCalled();
  });

  it("throws when neither explicit nor stored api key is available", async () => {
    storeGetMock.mockResolvedValue(undefined);

    await expect(resolveOpenaiApiKey(undefined)).rejects.toThrowError(
      "Missing Poe API key. Provide apiKey or run 'poe-code login'."
    );
  });

  it("throws when auth-store returns only whitespace", async () => {
    storeGetMock.mockResolvedValue("   ");

    await expect(resolveOpenaiApiKey(undefined)).rejects.toThrowError(
      "Missing Poe API key. Provide apiKey or run 'poe-code login'."
    );
  });
});

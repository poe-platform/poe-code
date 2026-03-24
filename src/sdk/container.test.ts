import { beforeEach, describe, expect, it, vi } from "vitest";

const createSecretStoreMock = vi.hoisted(() => vi.fn());
const createOptionResolversMock = vi.hoisted(() => vi.fn());

vi.mock("auth-store", () => ({
  createSecretStore: createSecretStoreMock
}));

vi.mock("../cli/options.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cli/options.js")>();
  return {
    ...actual,
    createOptionResolvers: createOptionResolversMock
  };
});

import { createSdkContainer } from "./container.js";

describe("createSdkContainer", () => {
  beforeEach(() => {
    createSecretStoreMock.mockReset();
    createOptionResolversMock.mockReset();
    createOptionResolversMock.mockReturnValue({
      ensure: vi.fn(),
      resolveModel: vi.fn(),
      resolveReasoning: vi.fn(),
      resolveConfigName: vi.fn(),
      resolveApiKey: vi.fn()
    });
  });

  it("uses auth store for SDK apiKeyStore read and write", async () => {
    const authStore = {
      get: vi.fn<() => Promise<string | null>>().mockResolvedValue("stored-key"),
      set: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      delete: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };

    createSecretStoreMock.mockReturnValue({
      backend: "file",
      store: authStore
    });

    const variables = { POE_AUTH_BACKEND: "file" };
    createSdkContainer({
      homeDir: "/sdk-home",
      variables
    });

    expect(createSecretStoreMock).toHaveBeenCalledWith(
      expect.objectContaining({
        env: variables,
        platform: process.platform
      })
    );

    const createOptionResolversInput = createOptionResolversMock.mock.calls[0]?.[0];
    expect(createOptionResolversInput).toBeDefined();

    const storedKey = await createOptionResolversInput.apiKeyStore.read();
    expect(storedKey).toBe("stored-key");
    expect(authStore.get).toHaveBeenCalledTimes(1);

    await createOptionResolversInput.apiKeyStore.write("new-key");
    expect(authStore.set).toHaveBeenCalledWith("new-key");
  });
});

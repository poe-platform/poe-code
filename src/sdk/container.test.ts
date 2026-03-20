import { beforeEach, describe, expect, it, vi } from "vitest";

const createAuthStoreMock = vi.hoisted(() => vi.fn());
const createOptionResolversMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/poe-auth", () => ({
  createAuthStore: createAuthStoreMock
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
    createAuthStoreMock.mockReset();
    createOptionResolversMock.mockReset();
    createOptionResolversMock.mockReturnValue({
      ensure: vi.fn(),
      resolveModel: vi.fn(),
      resolveReasoning: vi.fn(),
      resolveConfigName: vi.fn(),
      resolveApiKey: vi.fn(),
      normalizeApiKey: vi.fn()
    });
  });

  it("uses auth store for SDK apiKeyStore read and write", async () => {
    const authStore = {
      getApiKey: vi.fn<() => Promise<string | null>>().mockResolvedValue("stored-key"),
      setApiKey: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      deleteApiKey: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };

    createAuthStoreMock.mockReturnValue({
      backend: "file",
      store: authStore
    });

    const variables = { POE_AUTH_BACKEND: "file" };
    createSdkContainer({
      homeDir: "/sdk-home",
      variables
    });

    expect(createAuthStoreMock).toHaveBeenCalledWith(
      expect.objectContaining({
        env: variables,
        platform: process.platform
      })
    );

    const createOptionResolversInput = createOptionResolversMock.mock.calls[0]?.[0];
    expect(createOptionResolversInput).toBeDefined();

    const storedKey = await createOptionResolversInput.apiKeyStore.read();
    expect(storedKey).toBe("stored-key");
    expect(authStore.getApiKey).toHaveBeenCalledTimes(1);

    await createOptionResolversInput.apiKeyStore.write("new-key");
    expect(authStore.setApiKey).toHaveBeenCalledWith("new-key");
  });
});

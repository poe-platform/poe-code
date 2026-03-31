import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as authStore from "auth-store";
import * as optionsModule from "../cli/options.js";
import { createSdkContainer } from "./container.js";

let createSecretStoreSpy: ReturnType<typeof vi.spyOn>;
let createOptionResolversSpy: ReturnType<typeof vi.spyOn>;

describe("createSdkContainer", () => {
  beforeEach(() => {
    createSecretStoreSpy = vi.spyOn(authStore, "createSecretStore" as any);
    createOptionResolversSpy = vi.spyOn(optionsModule, "createOptionResolvers" as any).mockReturnValue({
      ensure: vi.fn(),
      resolveModel: vi.fn(),
      resolveReasoning: vi.fn(),
      resolveConfigName: vi.fn(),
      resolveApiKey: vi.fn()
    });
  });

  afterEach(() => {
    createSecretStoreSpy?.mockRestore();
    createOptionResolversSpy?.mockRestore();
  });

  it("uses auth store for SDK apiKeyStore read and write", async () => {
    const authStoreInstance = {
      get: vi.fn<() => Promise<string | null>>().mockResolvedValue("stored-key"),
      set: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      delete: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };

    createSecretStoreSpy.mockReturnValue({
      backend: "file",
      store: authStoreInstance
    });

    const variables = { POE_AUTH_BACKEND: "file" };
    createSdkContainer({
      homeDir: "/sdk-home",
      variables
    });

    expect(createSecretStoreSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        env: variables,
        platform: process.platform
      })
    );

    const createOptionResolversInput = createOptionResolversSpy.mock.calls[0]?.[0];
    expect(createOptionResolversInput).toBeDefined();

    const storedKey = await createOptionResolversInput.apiKeyStore.read();
    expect(storedKey).toBe("stored-key");
    expect(authStoreInstance.get).toHaveBeenCalledTimes(1);

    await createOptionResolversInput.apiKeyStore.write("new-key");
    expect(authStoreInstance.set).toHaveBeenCalledWith("new-key");
  });
});

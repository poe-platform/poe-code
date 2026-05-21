import { describe, expect, it, vi } from "vitest";
import type { SecretStore } from "auth-store";
import { apiKeyAuthStrategy } from "./api-key.js";
import type { AuthProvider } from "../types.js";

function makeSecretStore(initial: string | null = null): SecretStore {
  let value = initial;
  return {
    get: vi.fn(async () => value),
    set: vi.fn(async (next: string) => {
      value = next;
    }),
    delete: vi.fn(async () => {
      value = null;
    })
  };
}

const anthropicProvider: AuthProvider = {
  id: "anthropic",
  label: "Anthropic",
  baseUrl: "https://api.anthropic.com",
  auth: {
    kind: "api-key",
    envVar: "ANTHROPIC_API_KEY",
    storageKey: "provider:anthropic",
    prompt: { title: "Anthropic API key", placeholder: "sk-ant-..." }
  }
};

describe("apiKeyAuthStrategy.login", () => {
  it("stores the provided api key without prompting", async () => {
    const secretStore = makeSecretStore();
    const promptForSecret = vi.fn();

    const result = await apiKeyAuthStrategy.login(
      anthropicProvider,
      { apiKey: "sk-ant-supplied" },
      { secretStore, promptForSecret }
    );

    expect(result).toBe("sk-ant-supplied");
    expect(promptForSecret).not.toHaveBeenCalled();
    expect(secretStore.set).toHaveBeenCalledWith("sk-ant-supplied");
    expect(await secretStore.get()).toBe("sk-ant-supplied");
  });

  it("prompts when no api key is provided", async () => {
    const secretStore = makeSecretStore();
    const promptForSecret = vi.fn(async () => "sk-ant-prompted");

    const result = await apiKeyAuthStrategy.login(
      anthropicProvider,
      {},
      { secretStore, promptForSecret }
    );

    expect(promptForSecret).toHaveBeenCalledWith({
      title: "Anthropic API key",
      placeholder: "sk-ant-..."
    });
    expect(result).toBe("sk-ant-prompted");
    expect(secretStore.set).toHaveBeenCalledWith("sk-ant-prompted");
  });

  it("throws when no api key is available and no prompt is configured", async () => {
    const secretStore = makeSecretStore();

    await expect(
      apiKeyAuthStrategy.login(anthropicProvider, {}, { secretStore })
    ).rejects.toThrow(/anthropic/i);
    expect(secretStore.set).not.toHaveBeenCalled();
  });

  it("throws when prompt returns an empty string", async () => {
    const secretStore = makeSecretStore();
    const promptForSecret = vi.fn(async () => "   ");

    await expect(
      apiKeyAuthStrategy.login(anthropicProvider, {}, { secretStore, promptForSecret })
    ).rejects.toThrow(/anthropic/i);
    expect(secretStore.set).not.toHaveBeenCalled();
  });

  it("rejects providers that do not declare api-key auth", async () => {
    const secretStore = makeSecretStore();
    const oauthProvider: AuthProvider = {
      ...anthropicProvider,
      auth: { kind: "oauth" }
    };

    await expect(
      apiKeyAuthStrategy.login(oauthProvider, { apiKey: "x" }, { secretStore })
    ).rejects.toThrow(/api-key/);
  });
});

describe("apiKeyAuthStrategy.resolveCredential", () => {
  it("returns the stored credential", async () => {
    const secretStore = makeSecretStore("stored-key");

    await expect(
      apiKeyAuthStrategy.resolveCredential(anthropicProvider, { secretStore })
    ).resolves.toBe("stored-key");
  });

  it("throws a helpful error when the credential is missing", async () => {
    const secretStore = makeSecretStore(null);

    await expect(
      apiKeyAuthStrategy.resolveCredential(anthropicProvider, { secretStore })
    ).rejects.toThrow(/anthropic/i);
  });
});

describe("apiKeyAuthStrategy.isLoggedIn", () => {
  it("is true when a credential is stored", async () => {
    const secretStore = makeSecretStore("stored-key");
    await expect(
      apiKeyAuthStrategy.isLoggedIn(anthropicProvider, { secretStore })
    ).resolves.toBe(true);
  });

  it("is false when nothing is stored", async () => {
    const secretStore = makeSecretStore(null);
    await expect(
      apiKeyAuthStrategy.isLoggedIn(anthropicProvider, { secretStore })
    ).resolves.toBe(false);
  });

  it("is false when the stored value is blank", async () => {
    const secretStore = makeSecretStore("   ");
    await expect(
      apiKeyAuthStrategy.isLoggedIn(anthropicProvider, { secretStore })
    ).resolves.toBe(false);
  });
});

describe("apiKeyAuthStrategy.logout", () => {
  it("deletes the stored credential", async () => {
    const secretStore = makeSecretStore("stored-key");

    await apiKeyAuthStrategy.logout(anthropicProvider, { secretStore });

    expect(secretStore.delete).toHaveBeenCalledOnce();
    await expect(secretStore.get()).resolves.toBeNull();
  });
});

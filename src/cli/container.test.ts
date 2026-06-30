import { beforeEach, describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "./container.js";
import { ProviderRegistry } from "@poe-code/providers";
import type { FileSystem } from "../utils/file-system.js";

const checkAuthMock = vi.hoisted(() => vi.fn());
const resolveApiKeyViaOAuthMock = vi.hoisted(() => vi.fn());

vi.mock("poe-oauth", () => ({
  checkAuth: checkAuthMock
}));

vi.mock("./oauth-login.js", () => ({
  resolveApiKeyViaOAuth: resolveApiKeyViaOAuthMock
}));

const cwd = "/repo";
const homeDir = "/home/test";

function createMemfs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

describe("createCliContainer", () => {
  beforeEach(() => {
    checkAuthMock.mockReset();
    checkAuthMock.mockResolvedValue({ handle: "probe" });
    resolveApiKeyViaOAuthMock.mockReset();
    resolveApiKeyViaOAuthMock.mockResolvedValue("oauth-key");
  });
  it("exposes a ProviderRegistry instance", () => {
    const container = createCliContainer({
      fs: createMemfs(),
      prompts: vi.fn(),
      env: { cwd, homeDir }
    });
    expect(container.providerRegistry).toBeInstanceOf(ProviderRegistry);
  });

  it("registers Poe, Anthropic, OpenAI, and Cloudflare auth providers", () => {
    const container = createCliContainer({
      fs: createMemfs(),
      prompts: vi.fn(),
      env: { cwd, homeDir }
    });

    expect(container.providerRegistry.list().map((provider) => provider.id)).toEqual([
      "poe",
      "anthropic",
      "openai",
      "cloudflare"
    ]);
  });

  it("validates Poe credentials against the base URL without the /v1 API path", async () => {
    const container = createCliContainer({
      fs: createMemfs(),
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: { POE_BASE_URL: "https://gateway.example.test/v1" } }
    });

    await container.options.resolveApiKey({ value: "provided-key", dryRun: true });

    // The credential balance endpoint lives at <base>/usage/current_balance,
    // a sibling of /v1 — not under it. Validation must use poeBaseUrl.
    expect(checkAuthMock).toHaveBeenCalledWith({
      apiKey: "provided-key",
      baseUrl: "https://gateway.example.test"
    });
  });

  it("exchanges OAuth credentials through the configured Poe base URL", async () => {
    const container = createCliContainer({
      fs: createMemfs(),
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: { POE_BASE_URL: "https://gateway.example.test/v1" } }
    });

    await container.options.resolveApiKey({ dryRun: true, allowStored: false });

    expect(resolveApiKeyViaOAuthMock).toHaveBeenCalledWith({
      tokenEndpoint: "https://gateway.example.test/token"
    });
  });
});

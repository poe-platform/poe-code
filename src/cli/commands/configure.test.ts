import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeConfigure } from "./configure.js";
import { createCliContainer } from "../container.js";
import { createHomeFs, createTestProgram } from "../../../tests/test-helpers.js";
import { loadConfiguredServices } from "../../services/config.js";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import { createProviderStub } from "../../../tests/provider-stub.js";
import type { AuthProvider } from "@poe-code/providers";
import type { FileSystem } from "../../utils/file-system.js";

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = resolveConfigPath(homeDir);

function createContainer(fs: FileSystem, envVars: Record<string, string | undefined> = {}) {
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir, variables: envVars },
    logger: () => {}
  });
}

function createFakeProvider(id: string, label: string): AuthProvider {
  return {
    id,
    label,
    summary: undefined,
    baseUrl: "https://fake.example.com",
    auth: {
      kind: "api-key",
      envVar: `${id.toUpperCase()}_API_KEY`,
      storageKey: `provider:${id}`,
      prompt: { title: `${label} API key` }
    },
    supportsAgents: ["claude-code", "codex"]
  };
}

function mockOptions(container: ReturnType<typeof createContainer>) {
  vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
  vi.spyOn(container.options, "resolveModel").mockImplementation(async ({ defaultValue }) => defaultValue);
}

function stubInvoke(container: ReturnType<typeof createContainer>) {
  const fakeEntry = createProviderStub({ name: "claude-code", label: "Claude Code" });
  vi.spyOn(container.registry, "invoke").mockImplementation(async (_n, _op, runner) => {
    return runner(fakeEntry);
  });
}

describe("configure provider resolution", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  it("auto-selects the single logged-in provider", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("poe");
  });

  it("prompts when >1 eligible providers are logged in", async () => {
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const promptsMock = vi.fn().mockResolvedValue({ serviceSelection: "anthropic" });
    const container = createCliContainer({
      fs,
      prompts: promptsMock,
      env: { cwd, homeDir, variables: {} },
      logger: () => {}
    });
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      ...container.providerRegistry.forAgent("claude-code"),
      fakeAnthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("anthropic");
    expect(promptsMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "serviceSelection" })
    );
  });

  it("triggers login when the only candidate is not logged in", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    const loginSpy = vi
      .spyOn(container.providerRegistry, "login")
      .mockResolvedValue();
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {
      apiKey: "sk-fresh"
    });

    expect(loginSpy).toHaveBeenCalledWith(
      "poe",
      { apiKey: "sk-fresh" },
      expect.any(Object)
    );
    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("poe");
  });

  it("prompts to pick a provider then triggers login when none logged in", async () => {
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const promptsMock = vi.fn().mockResolvedValue({ serviceSelection: "anthropic" });
    const container = createCliContainer({
      fs,
      prompts: promptsMock,
      env: { cwd, homeDir, variables: {} },
      logger: () => {}
    });
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      ...container.providerRegistry.forAgent("claude-code"),
      fakeAnthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    const loginSpy = vi
      .spyOn(container.providerRegistry, "login")
      .mockResolvedValue();
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    expect(promptsMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "serviceSelection" })
    );
    expect(loginSpy).toHaveBeenCalledWith(
      "anthropic",
      { apiKey: undefined },
      expect.any(Object)
    );
    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("anthropic");
  });

  it("errors with --yes when no provider is logged in", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    stubInvoke(container);

    await expect(
      executeConfigure(
        createTestProgram(["node", "cli", "--yes"]),
        container,
        "claude-code",
        {}
      )
    ).rejects.toThrow(/No logged-in providers/);
  });

  it("triggers login for --provider when it is not logged in", async () => {
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      ...container.providerRegistry.forAgent("claude-code"),
      fakeAnthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    const loginSpy = vi
      .spyOn(container.providerRegistry, "login")
      .mockResolvedValue();
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {
      provider: "anthropic",
      apiKey: "sk-fresh"
    });

    expect(loginSpy).toHaveBeenCalledWith(
      "anthropic",
      { apiKey: "sk-fresh" },
      expect.any(Object)
    );
  });

  it("dry-run succeeds without any logged-in provider", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    stubInvoke(container);

    await expect(
      executeConfigure(
        createTestProgram(["node", "cli", "--dry-run", "--yes"]),
        container,
        "claude-code",
        {}
      )
    ).resolves.not.toThrow();
  });

  it("honors the --provider flag", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {
      provider: "anthropic"
    });

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("anthropic");
  });

  it("honors the POE_CODE_PROVIDER env var", async () => {
    const container = createContainer(fs, { POE_CODE_PROVIDER: "anthropic" });
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("anthropic");
  });

  it("--flag takes precedence over POE_CODE_PROVIDER env var", async () => {
    const container = createContainer(fs, { POE_CODE_PROVIDER: "anthropic" });
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {
      provider: "poe"
    });

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("poe");
  });

  it("errors when --yes is given with >1 eligible providers and no flag or env", async () => {
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      ...container.providerRegistry.forAgent("claude-code"),
      fakeAnthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await expect(
      executeConfigure(
        createTestProgram(["node", "cli", "--yes"]),
        container,
        "claude-code",
        {}
      )
    ).rejects.toThrow(/Use --provider/);
  });

  it("persists the resolved provider in services.json", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]).toMatchObject({ provider: "poe" });
  });
});

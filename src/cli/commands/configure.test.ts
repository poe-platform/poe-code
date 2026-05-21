import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { executeConfigure, registerConfigureCommand } from "./configure.js";
import { createCliContainer } from "../container.js";
import { createHomeFs, createTestProgram } from "../../../tests/test-helpers.js";
import { loadConfiguredServices } from "../../services/config.js";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import { claudeCodeAgent } from "@poe-code/agent-defs";
import { createProviderStub } from "../../../tests/provider-stub.js";
import type { AuthProvider } from "@poe-code/providers";
import type { FileSystem } from "../../utils/file-system.js";
import { PROVIDER_NAME } from "../constants.js";
import { registerProviderCommand } from "./provider.js";

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = resolveConfigPath(homeDir);
const fixtureDir = path.join(import.meta.dirname, "__fixtures__");

function createContainer(fs: FileSystem, envVars: Record<string, string | undefined> = {}) {
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir, variables: envVars },
    logger: () => {}
  });
}

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run");
  return program;
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
    supportsAgents: ["claude-code", "codex"],
    apiShapes: [
      {
        id: "anthropic-messages",
        defaultBaseUrl: `https://api.${id}.example.com/anthropic`
      },
      {
        id: "openai-responses",
        defaultBaseUrl: `https://api.${id}.example.com/responses`
      }
    ]
  };
}

function includeFakeProvider(
  container: ReturnType<typeof createContainer>,
  fakeProvider: AuthProvider
): void {
  const originalGet = container.providerRegistry.get.bind(container.providerRegistry);
  vi.spyOn(container.providerRegistry, "get").mockImplementation((id) =>
    id === fakeProvider.id ? fakeProvider : originalGet(id)
  );
}

function useOnlyPoeCandidate(container: ReturnType<typeof createContainer>): void {
  const poe = container.providerRegistry.get("poe");
  if (!poe) {
    throw new Error("Expected Poe provider to be registered.");
  }
  vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([poe]);
}

function mockOptions(container: ReturnType<typeof createContainer>) {
  vi.spyOn(container.providerRegistry, "resolveCredential").mockImplementation(
    async (_id, options) => options?.apiKey ?? "sk-test"
  );
  vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
  vi.spyOn(container.options, "resolveModel").mockImplementation(
    async ({ defaultValue }) => defaultValue
  );
  vi.spyOn(container.options, "resolveReasoning").mockImplementation(
    async ({ defaultValue }) => defaultValue
  );
}

function stubInvoke(container: ReturnType<typeof createContainer>) {
  const fakeEntry = createProviderStub({ name: "claude-code", label: "Claude Code" });
  vi.spyOn(container.registry, "invoke").mockImplementation(async (_n, _op, runner) => {
    return runner(fakeEntry);
  });
}

function stubInvokeAndCaptureProvider(container: ReturnType<typeof createContainer>) {
  let provider: Record<string, unknown> | undefined;
  const fakeEntry = createProviderStub({
    name: "claude-code",
    label: "Claude Code",
    configure: async ({ options }) => {
      provider = (options as Record<string, unknown>).provider as Record<string, unknown>;
    }
  });
  vi.spyOn(container.registry, "invoke").mockImplementation(async (_n, _op, runner) => {
    return runner(fakeEntry);
  });
  return {
    provider: () => provider
  };
}

describe("configure provider resolution", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  it("auto-selects the single logged-in provider", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    const forAgentSpy = vi.spyOn(container.providerRegistry, "forAgent");
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockImplementation(
      async (id) => id === "poe"
    );
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    expect(forAgentSpy).toHaveBeenCalledWith(claudeCodeAgent);
    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe(PROVIDER_NAME);
  });

  it("treats POE_API_KEY as logged-in Poe provider with --yes", async () => {
    const container = createContainer(fs, { POE_API_KEY: "sk-env" });
    mockOptions(container);
    stubInvoke(container);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {});

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services.codex?.provider).toBe(PROVIDER_NAME);
  });

  it("keeps claude-code on Poe with --yes when only POE_API_KEY is set", async () => {
    const container = createContainer(fs, { POE_API_KEY: "sk-env" });
    mockOptions(container);

    await executeConfigure(
      createTestProgram(["node", "cli", "--yes"]),
      container,
      "claude-code",
      {}
    );

    const settings = JSON.parse(await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe("https://api.poe.com/anthropic");

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe(PROVIDER_NAME);
  });

  it("configures claude-code against Anthropic after provider login", async () => {
    const container = createContainer(fs);
    const providerProgram = createTestProgram(["node", "cli", "--yes"]);
    registerProviderCommand(providerProgram, container);

    await providerProgram.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "anthropic",
      "--api-key",
      "sk-ant-test"
    ]);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "anthropic"
    });

    const settings = JSON.parse(await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]).toMatchObject({
      provider: "anthropic",
      apiShape: "anthropic-messages"
    });
  });

  it("auto-selects Anthropic when Anthropic is the only logged-in compatible provider", async () => {
    const container = createContainer(fs);
    const providerProgram = createTestProgram(["node", "cli", "--yes"]);
    registerProviderCommand(providerProgram, container);

    await providerProgram.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "anthropic",
      "--api-key",
      "sk-ant-test"
    ]);

    await executeConfigure(
      createTestProgram(["node", "cli", "--yes"]),
      container,
      "claude-code",
      {}
    );

    const settings = JSON.parse(await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]).toMatchObject({
      provider: "anthropic",
      apiShape: "anthropic-messages"
    });
  });

  it("configures Anthropic with an explicit API key without using Poe key validation", async () => {
    const container = createContainer(fs);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "anthropic",
      apiKey: "sk-ant-test"
    });

    const settings = JSON.parse(await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]).toMatchObject({
      provider: "anthropic",
      apiShape: "anthropic-messages"
    });
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
    includeFakeProvider(container, fakeAnthropicProvider);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      ...container.providerRegistry.forAgent(claudeCodeAgent),
      fakeAnthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("anthropic");
    expect(promptsMock).toHaveBeenCalledWith(expect.objectContaining({ name: "serviceSelection" }));
  });

  it("triggers login when the only candidate is not logged in", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    useOnlyPoeCandidate(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    const loginSpy = vi.spyOn(container.providerRegistry, "login").mockResolvedValue();
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {
      apiKey: "sk-fresh"
    });

    expect(loginSpy).toHaveBeenCalledWith("poe", { apiKey: "sk-fresh" }, expect.any(Object));
    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe(PROVIDER_NAME);
  });

  it("uses the OAuth-capable Poe resolver when the only candidate is not logged in", async () => {
    const container = createContainer(fs);
    const resolveApiKeySpy = vi
      .spyOn(container.options, "resolveApiKey")
      .mockResolvedValue("sk-oauth");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );
    useOnlyPoeCandidate(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    expect(resolveApiKeySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        allowStored: false,
        value: undefined
      })
    );
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
    includeFakeProvider(container, fakeAnthropicProvider);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      ...container.providerRegistry.forAgent(claudeCodeAgent),
      fakeAnthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    const loginSpy = vi.spyOn(container.providerRegistry, "login").mockResolvedValue();
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    expect(promptsMock).toHaveBeenCalledWith(expect.objectContaining({ name: "serviceSelection" }));
    expect(loginSpy).toHaveBeenCalledWith("anthropic", { apiKey: undefined }, expect.any(Object));
    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]?.provider).toBe("anthropic");
  });

  it("errors with --yes when no provider is logged in", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    stubInvoke(container);

    await expect(
      executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {})
    ).rejects.toThrow(/No logged-in providers/);
  });

  it("triggers login for --provider when it is not logged in", async () => {
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const container = createContainer(fs);
    includeFakeProvider(container, fakeAnthropicProvider);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      ...container.providerRegistry.forAgent(claudeCodeAgent),
      fakeAnthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    const loginSpy = vi.spyOn(container.providerRegistry, "login").mockResolvedValue();
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {
      provider: "anthropic",
      apiKey: "sk-fresh"
    });

    expect(loginSpy).toHaveBeenCalledWith("anthropic", { apiKey: "sk-fresh" }, expect.any(Object));
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
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const container = createContainer(fs);
    includeFakeProvider(container, fakeAnthropicProvider);
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
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const container = createContainer(fs, { POE_CODE_PROVIDER: "anthropic" });
    includeFakeProvider(container, fakeAnthropicProvider);
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
    expect(services["claude-code"]?.provider).toBe(PROVIDER_NAME);
  });

  it("errors when --yes is given with >1 eligible providers and no flag or env", async () => {
    const fakeAnthropicProvider = createFakeProvider("anthropic", "Anthropic");
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([
      ...container.providerRegistry.forAgent(claudeCodeAgent),
      fakeAnthropicProvider
    ]);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    stubInvoke(container);

    await expect(
      executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {})
    ).rejects.toThrow(/Use --provider/);
  });

  it("persists the resolved provider in services.json", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockImplementation(
      async (id) => id === "poe"
    );
    stubInvoke(container);

    await executeConfigure(createTestProgram(), container, "claude-code", {});

    const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(saved.configured_services["claude-code"]).toMatchObject({
      provider: "poe",
      apiShape: "anthropic-messages"
    });
  });

  it("uses the stored login shape base URL when configuring an agent", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    const capture = stubInvokeAndCaptureProvider(container);
    const providerProgram = createTestProgram(["node", "cli", "--yes"]);
    registerProviderCommand(providerProgram, container);

    await providerProgram.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "poe",
      "--shape-base-url",
      "anthropic-messages=https://example/anth"
    ]);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "poe"
    });

    expect(capture.provider()?.baseUrl).toBe("https://example/anth");
  });

  it("uses explicit --base-url before a stored shape base URL", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    const capture = stubInvokeAndCaptureProvider(container);
    const providerProgram = createTestProgram(["node", "cli", "--yes"]);
    registerProviderCommand(providerProgram, container);

    await providerProgram.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "poe",
      "--shape-base-url",
      "anthropic-messages=https://stored.example/anth"
    ]);

    const program = createBaseProgram();
    registerConfigureCommand(program, container);
    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "configure",
      "claude-code",
      "--provider",
      "poe",
      "--base-url",
      "https://explicit.example/anth"
    ]);

    expect(capture.provider()?.baseUrl).toBe("https://explicit.example/anth");
  });

  it("uses explicit --shape-base-url before --base-url for the resolved shape", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    const capture = stubInvokeAndCaptureProvider(container);

    const program = createBaseProgram();
    registerConfigureCommand(program, container);
    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "configure",
      "claude-code",
      "--provider",
      "poe",
      "--base-url",
      "https://generic.example/anth",
      "--shape-base-url",
      "anthropic-messages=https://shape.example/anth"
    ]);

    expect(capture.provider()?.baseUrl).toBe("https://shape.example/anth");
  });

  it("does not read base URLs from environment variables", async () => {
    const container = createContainer(fs, {
      POE_API_KEY: "sk-env",
      POE_BASE_URL: "https://env.example"
    });
    mockOptions(container);
    const capture = stubInvokeAndCaptureProvider(container);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "poe"
    });

    expect(capture.provider()?.baseUrl).toBe("https://api.poe.com/anthropic");
  });

  it("rejects unknown configure --shape-base-url shape ids before writing", async () => {
    const container = createContainer(fs);
    mockOptions(container);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    const invokeSpy = vi.spyOn(container.registry, "invoke");

    const program = createBaseProgram();
    registerConfigureCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "--yes",
        "configure",
        "claude-code",
        "--provider",
        "poe",
        "--shape-base-url",
        "missing-shape=https://example/missing"
      ])
    ).rejects.toThrow(/Unknown API shape "missing-shape" for provider "poe"/);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("keeps the claude-code Poe configure snapshot byte-identical with only POE_API_KEY", async () => {
    const container = createContainer(fs, { POE_API_KEY: "sk-test" });
    mockOptions(container);

    await executeConfigure(
      createTestProgram(["node", "cli", "--yes"]),
      container,
      "claude-code",
      {}
    );

    const actual = await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8");
    const expected = await readFile(
      path.join(fixtureDir, "plan14-pre-phase4-claude-settings.json"),
      "utf8"
    );
    expect(actual).toBe(expected);
  });

  it("--skip-if-configured exits before writes when configure would only create a backup", async () => {
    const container = createContainer(fs, { POE_API_KEY: "sk-env" });
    mockOptions(container);

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "poe"
    });

    const configFile = `${homeDir}/.codex/config.toml`;
    const before = await fs.readFile(configFile, "utf8");
    const writeSpy = vi.spyOn(fs, "writeFile");

    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "codex", {
      provider: "poe",
      skipIfConfigured: true
    });

    expect(writeSpy).not.toHaveBeenCalled();
    await expect(fs.readFile(configFile, "utf8")).resolves.toBe(before);
  });
});

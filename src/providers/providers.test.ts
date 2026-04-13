import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import type { FileSystem } from "../utils/file-system.js";
import type { ProviderContext } from "../cli/service-registry.js";
import { createCliEnvironment } from "../cli/environment.js";
import { createTestCommandContext } from "../../tests/test-command-context.js";
import { createLoggerFactory } from "../cli/logger.js";
import {
  createMockFs,
  parseToml,
  serializeToml,
  type MockFileSystem
} from "@poe-code/config-mutations/testing";
import { createCliContainer } from "../cli/container.js";
import {
  buildProviderContext,
  createExecutionResources
} from "../cli/commands/shared.js";
import { createProviderStub } from "../../tests/provider-stub.js";
import * as claudeService from "./claude-code.js";
import * as codexService from "./codex.js";
import * as kimiService from "./kimi.js";
import * as opencodeService from "./opencode.js";
import { provider as poeAgentProvider, spawnPoeAgentWithAcp } from "./poe-agent.js";
import { AcpClient } from "@poe-code/poe-acp-client";
import {
  CLAUDE_CODE_VARIANTS,
  stripModelNamespace,
  DEFAULT_CODEX_MODEL,
  DEFAULT_KIMI_MODEL,
  KIMI_MODELS,
  DEFAULT_FRONTIER_MODEL,
  FRONTIER_MODELS,
  PROVIDER_NAME
} from "../cli/constants.js";

const createAgentSessionMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());
const disposeMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/poe-agent", () => ({
  createAgentSession: createAgentSessionMock
}));

const resolveVariantModel = (
  variant: keyof typeof CLAUDE_CODE_VARIANTS
): string => CLAUDE_CODE_VARIANTS[variant];

const CLAUDE_MODEL_HAIKU = resolveVariantModel("haiku");
const CLAUDE_MODEL_SONNET = resolveVariantModel("sonnet");
const CLAUDE_MODEL_OPUS = resolveVariantModel("opus");

const cwd = "/repo";
const homeDir = "/home/test";

describe("buildProviderContext", () => {
  it("skips resolving provider paths", () => {
    const mockFs = createMockFs({}, homeDir);
    const container = createCliContainer({
      fs: mockFs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      logger: vi.fn()
    });

    const adapter = createProviderStub({
      name: "noop",
      label: "Noop"
    });

    const resources = createExecutionResources(
      container,
      { dryRun: false, assumeYes: true },
      "test-scope"
    );

    const context = buildProviderContext(container, adapter, resources);

    expect("paths" in context).toBe(false);
  });
});

describe("provider filtering", () => {
  it("omits disabled providers from the registry list", () => {
    const container = createCliContainer({
      fs: createMockFs({}, homeDir),
      prompts: async () => ({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const names = container.registry.list().map((adapter) => adapter.name);
    expect(names).not.toContain("roo-code");
  });
});

describe("claude-code service", () => {
  let mockFsObj: FileSystem;
  const home = "/home/user";
  const settingsPath = path.join(home, ".claude", "settings.json");
  let env = createCliEnvironment({
    cwd: home,
    homeDir: home
  });

  beforeEach(async () => {
    mockFsObj = createMockFs({}, home);
    env = createCliEnvironment({
      cwd: home,
      homeDir: home
    });
  });

  function createProviderTestContext(
    runCommand: ReturnType<typeof vi.fn>,
    options: { dryRun?: boolean } = {}
  ): { context: ProviderContext; logs: string[] } {
    const logs: string[] = [];
    const logger = createLoggerFactory((message) => {
      logs.push(message);
    }).create({
      dryRun: options.dryRun ?? false,
      verbose: true,
      scope: "test:claude"
    });

    const context = {
      env,
      command: {
        runCommand,
        fs: mockFsObj
      },
      logger,
      async runCheck(check) {
        await check.run({
          isDryRun: logger.context.dryRun,
          runCommand,
          logDryRun: (message) => logger.dryRun(message)
        });
      }
    } as ProviderContext;

    return { context, logs };
  }

  type ConfigureOptions = Parameters<
    typeof claudeService.claudeCodeService.configure
  >[0]["options"];

  type UnconfigureOptions = Parameters<
    typeof claudeService.claudeCodeService.unconfigure
  >[0]["options"];

  const buildConfigureOptions = (
    overrides: Partial<ConfigureOptions> = {}
  ): ConfigureOptions => ({
    env,
    apiKey: "sk-test",
    model: CLAUDE_MODEL_SONNET,
    ...overrides
  });

  const buildUnconfigureOptions = (
    overrides: Partial<UnconfigureOptions> = {}
  ): UnconfigureOptions => ({
    env,
    ...overrides
  });

  async function configureClaude(
    overrides: Partial<ConfigureOptions> = {}
  ): Promise<void> {
    await claudeService.claudeCodeService.configure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildConfigureOptions(overrides)
    });
  }

  async function unconfigureClaude(
    overrides: Partial<UnconfigureOptions> = {}
  ): Promise<boolean> {
    return claudeService.claudeCodeService.unconfigure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildUnconfigureOptions(overrides)
    });
  }

  it("removeClaudeCode prunes manifest-managed env keys from settings json", async () => {
    await mockFsObj.mkdir(path.dirname(settingsPath), { recursive: true });
    await mockFsObj.writeFile(
      settingsPath,
      JSON.stringify(
        {
          apiKeyHelper: "echo sk-test",
          theme: "dark",
          env: {
            ANTHROPIC_BASE_URL: "https://api.poe.com",
            ANTHROPIC_DEFAULT_HAIKU_MODEL: CLAUDE_MODEL_HAIKU,
            ANTHROPIC_DEFAULT_SONNET_MODEL: CLAUDE_MODEL_SONNET,
            ANTHROPIC_DEFAULT_OPUS_MODEL: CLAUDE_MODEL_OPUS,
            CUSTOM: "value"
          },
          model: CLAUDE_MODEL_SONNET,
          customField: "should-remain"
        },
        null,
        2
      ),
      { encoding: "utf8" }
    );

    const removed = await unconfigureClaude();
    expect(removed).toBe(true);

    const content = await mockFsObj.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({
      theme: "dark",
      env: {
        CUSTOM: "value"
      },
      customField: "should-remain"
    });
  });

  it("removeClaudeCode deletes settings file when only manifest keys remain", async () => {
    await mockFsObj.mkdir(path.dirname(settingsPath), { recursive: true });
    await mockFsObj.writeFile(
      settingsPath,
      JSON.stringify(
        {
          apiKeyHelper: "echo sk-test",
          env: {
            ANTHROPIC_BASE_URL: "https://api.poe.com",
            ANTHROPIC_DEFAULT_HAIKU_MODEL: CLAUDE_MODEL_HAIKU,
            ANTHROPIC_DEFAULT_SONNET_MODEL: CLAUDE_MODEL_SONNET,
            ANTHROPIC_DEFAULT_OPUS_MODEL: CLAUDE_MODEL_OPUS
          },
          model: CLAUDE_MODEL_SONNET
        },
        null,
        2
      ),
      { encoding: "utf8" }
    );

    const removed = await unconfigureClaude();
    expect(removed).toBe(true);

    await expect(mockFsObj.readFile(settingsPath, "utf8")).rejects.toThrow();
  });

  it("removeClaudeCode returns false when settings file absent", async () => {
    const removed = await unconfigureClaude();
    expect(removed).toBe(false);
  });

  it("creates settings json with claude env configuration", async () => {
    await configureClaude();

    const content = await mockFsObj.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({
      apiKeyHelper: "echo sk-test",
      env: {
        ANTHROPIC_BASE_URL: "https://api.poe.com"
      },
      model: stripModelNamespace(CLAUDE_MODEL_SONNET)
    });
  });

  it("uses POE_BASE_URL override for ANTHROPIC_BASE_URL", async () => {
    env = createCliEnvironment({
      cwd: home,
      homeDir: home,
      variables: { POE_BASE_URL: "https://proxy.example.com/v1" }
    });

    await configureClaude();

    const content = await mockFsObj.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({
      apiKeyHelper: "echo sk-test",
      env: {
        ANTHROPIC_BASE_URL: "https://proxy.example.com"
      },
      model: stripModelNamespace(CLAUDE_MODEL_SONNET)
    });
  });

  it("removes existing apiKeyHelper during configure", async () => {
    await mockFsObj.mkdir(path.dirname(settingsPath), { recursive: true });
    await mockFsObj.writeFile(
      settingsPath,
      JSON.stringify(
        {
          apiKeyHelper: "/existing/helper.sh",
          theme: "dark",
          env: {
            ANTHROPIC_BASE_URL: "https://custom.example.com",
            CUSTOM: "value"
          }
        },
        null,
        2
      ),
      { encoding: "utf8" }
    );

    await configureClaude();

    const content = await mockFsObj.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({
      apiKeyHelper: "echo sk-test",
      theme: "dark",
      env: {
        ANTHROPIC_BASE_URL: "https://api.poe.com",
        CUSTOM: "value"
      },
      model: stripModelNamespace(CLAUDE_MODEL_SONNET)
    });
  });

  it("runs the Claude CLI health check via runCommand when invoking the provider test", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: '{"type":"text","text":"CLAUDE_CODE_OK"}\n',
      stderr: "",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await claudeService.claudeCodeService.test?.(context);

    expect(runCommand).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "-p", "Output exactly: CLAUDE_CODE_OK",
        "--model", expect.stringContaining("claude-sonnet-4-6")
      ])
    );
  });

  it("skips the Claude health check during dry runs", async () => {
    const runCommand = vi.fn();
    const { context } = createProviderTestContext(runCommand, { dryRun: true });

    await claudeService.claudeCodeService.test?.(context);

    expect(runCommand).not.toHaveBeenCalled();
  });

  it("includes stdout and stderr when the Claude health check command fails", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "FAIL_STDOUT\n",
      stderr: "FAIL_STDERR\n",
      exitCode: 1
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(
      claudeService.claudeCodeService.test?.(context)
    ).rejects.toThrow(/FAIL_STDOUT/);
  });

  it("includes stdout and stderr when the Claude health check output is unexpected", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "WRONG\n",
      stderr: "WARN\n",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(
      claudeService.claudeCodeService.test?.(context)
    ).rejects.toThrow(/CLAUDE_CODE_OK/);
  });

  it("falls back to Windows path lookup when which is unavailable", async () => {
    const captured: Array<{ command: string; args: string[] }> = [];
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      captured.push({ command, args });
      if (command === "which") {
        return { stdout: "", stderr: "not found", exitCode: 1 };
      }
      if (command === "where") {
        return { stdout: "C:\\\\Apps\\\\claude.cmd\r\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const binaryCheck = claudeService.CLAUDE_CODE_INSTALL_DEFINITION.check;
    await binaryCheck.run({ isDryRun: false, runCommand });

    expect(captured.map((entry) => entry.command)).toEqual(["which", "where"]);
    expect(captured[1]).toEqual({ command: "where", args: ["claude"] });
  });

  it("creates ~/.claude directory when configuring", async () => {
    await configureClaude();
    await mockFsObj.stat(path.join(home, ".claude"));
  });

  it("does not create history.jsonl when configuring", async () => {
    await configureClaude();
    await expect(mockFsObj.stat(path.join(home, ".claude", "history.jsonl"))).rejects.toThrow();
  });
});

describe("codex service", () => {
  let mockFsObj: FileSystem;
  let mockFs: MockFileSystem;
  const home = "/home/user";
  const configDir = path.join(home, ".codex");
  const configPath = path.join(configDir, "config.toml");
  let env = createCliEnvironment({ cwd: home, homeDir: home });

  beforeEach(async () => {
    mockFs = createMockFs({}, home);
    mockFsObj = mockFs;
    env = createCliEnvironment({ cwd: home, homeDir: home });
  });

  function createProviderTestContext(
    runCommand: ReturnType<typeof vi.fn>,
    options: { dryRun?: boolean } = {}
  ): { context: ProviderContext; logs: string[] } {
    const logs: string[] = [];
    const logger = createLoggerFactory((message) => {
      logs.push(message);
    }).create({
      dryRun: options.dryRun ?? false,
      verbose: true,
      scope: "test:codex"
    });

    const context = {
      env,
      command: {
        runCommand,
        fs: mockFsObj
      },
      logger,
      async runCheck(check) {
        await check.run({
          isDryRun: logger.context.dryRun,
          runCommand,
          logDryRun: (message) => logger.dryRun(message)
        });
      }
    } as ProviderContext;

    return { context, logs };
  }

  type ConfigureOptions = Parameters<
    typeof codexService.codexService.configure
  >[0]["options"];

  type UnconfigureOptions = Parameters<
    typeof codexService.codexService.unconfigure
  >[0]["options"];

  const buildConfigureOptions = (
    overrides: Partial<ConfigureOptions> = {}
  ): ConfigureOptions => ({
    env,
    apiKey: "sk-test",
    model: DEFAULT_CODEX_MODEL,
    reasoningEffort: "medium",
    ...overrides
  });

  const buildUnconfigureOptions = (
    overrides: Partial<UnconfigureOptions> = {}
  ): UnconfigureOptions => ({
    env,
    ...overrides
  });

  async function configureCodex(
    overrides: Partial<ConfigureOptions> = {}
  ): Promise<void> {
    await codexService.codexService.configure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildConfigureOptions(overrides)
    });
  }

  async function unconfigureCodex(
    overrides: Partial<UnconfigureOptions> = {}
  ): Promise<boolean> {
    return codexService.codexService.unconfigure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildUnconfigureOptions(overrides)
    });
  }

  it("writes codex config as profile from template", async () => {
    await configureCodex({
      timestamp: () => "20240101T000000"
    });

    const doc = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    expect(doc["model_provider"]).toBe("poe");

    const profiles = doc["profiles"] as Record<string, Record<string, unknown>>;
    const defaultProfileName =
      codexService.deriveCodexProfileName(DEFAULT_CODEX_MODEL);
    const codexProfile = profiles[defaultProfileName];
    expect(codexProfile["model"]).toBe(stripModelNamespace(DEFAULT_CODEX_MODEL));
    expect(codexProfile["model_provider"]).toBe("poe");
    expect(codexProfile["model_reasoning_effort"]).toBe("medium");
    expect(codexProfile["model_verbosity"]).toBe("medium");

    const providers = doc["model_providers"] as Record<string, Record<string, unknown>>;
    expect(providers["poe"]["experimental_bearer_token"]).toBe("sk-test");
    expect(providers["poe"]["requires_openai_auth"]).toBe(false);
    expect(providers["poe"]["supports_websockets"]).toBe(false);

    await expect(mockFsObj.readFile(path.join(configDir, "auth.json"), "utf8")).rejects
      .toThrow();

    await expect(
      mockFsObj.readFile(`${configPath}.backup.20240101T000000`, "utf8")
    ).rejects.toThrow();
  });

  it("writes opus model as opus profile", async () => {
    await configureCodex({
      model: "anthropic/claude-opus-4.6",
      reasoningEffort: "high"
    });

    const doc = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    const profiles = doc["profiles"] as Record<string, Record<string, unknown>>;
    const opusProfile = profiles["opus"];
    expect(opusProfile["model"]).toBe("claude-opus-4.6");
    expect(opusProfile["model_provider"]).toBe("poe");
    expect(opusProfile["model_reasoning_effort"]).toBe("high");
  });

  it("replaces stale profile when reconfiguring with a different model", async () => {
    await configureCodex({ model: DEFAULT_CODEX_MODEL });

    await configureCodex({
      model: "anthropic/claude-opus-4.6",
      reasoningEffort: "high"
    });

    const doc = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    const profiles = doc["profiles"] as Record<string, Record<string, unknown>>;
    const defaultProfileName =
      codexService.deriveCodexProfileName(DEFAULT_CODEX_MODEL);
    expect(profiles["opus"]).toBeDefined();
    expect(profiles[defaultProfileName]).toBeUndefined();
  });

  it("uses POE_BASE_URL when writing base_url", async () => {
    env = createCliEnvironment({
      cwd: home,
      homeDir: home,
      variables: { POE_BASE_URL: "https://proxy.example.com/v1" }
    });

    await configureCodex();

    const doc = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    const providers = doc["model_providers"] as Record<string, unknown>;
    const poe = providers["poe"] as Record<string, unknown>;
    expect(poe.base_url).toBe("https://proxy.example.com/v1");
  });

  it("removes generated config without restoring backup", async () => {
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(configPath, "original", { encoding: "utf8" });

    await configureCodex({
      timestamp: () => "20240101T000000"
    });

    await mockFsObj.writeFile(
      `${configPath}.backup.20240101T000000`,
      "legacy",
      { encoding: "utf8" }
    );
    const removed = await unconfigureCodex();
    expect(removed).toBe(true);

    await expect(mockFsObj.readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("deletes config when content matches template", async () => {
    await configureCodex({
      timestamp: () => "20240101T000000"
    });

    const removed = await unconfigureCodex();
    expect(removed).toBe(true);

    await expect(mockFsObj.readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("keeps config when file differs from template", async () => {
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(configPath, 'model = "custom"', {
      encoding: "utf8"
    });

    const removed = await unconfigureCodex();
    expect(removed).toBe(false);

    const content = await mockFsObj.readFile(configPath, "utf8");
    expect(content).toBe('model = "custom"');
  });

  it("removes codex block with different formatting", async () => {
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      [
        'model_provider="poe"',
        `model="${DEFAULT_CODEX_MODEL}"`,
        'model_reasoning_effort="medium"',
        'model_verbosity="medium"',
        "",
        "[model_providers.poe]",
        'name="poe"',
        'base_url="https://api.poe.com/v1"',
        'wire_api="chat"',
        'env_key="POE_API_KEY"',
        'experimental_bearer_token="POE_API_KEY"',
        "",
        "[features]",
        "foo = true",
        ""
      ].join("\n"),
      { encoding: "utf8" }
    );

    const removed = await unconfigureCodex();
    expect(removed).toBe(true);

    const content = await mockFsObj.readFile(configPath, "utf8");
    expect(content.trim()).toBe("[features]\nfoo = true");
  });

  it("removes legacy codex provider configuration", async () => {
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      [
        'model_provider="poe"',
        `model="${DEFAULT_CODEX_MODEL}"`,
        'model_reasoning_effort="medium"',
        "",
        "[model_providers.poe]",
        'name="poe"',
        'base_url="https://api.poe.com/v1"',
        'wire_api="chat"',
        'env_key="OPENAI_API_KEY"',
        "",
        "[features]",
        "foo = true",
        ""
      ].join("\n"),
      { encoding: "utf8" }
    );

    const removed = await unconfigureCodex();
    expect(removed).toBe(true);

    const content = await mockFsObj.readFile(configPath, "utf8");
    expect(content.trim()).toBe("[features]\nfoo = true");
  });

  it("removes codex configuration with wire_api responses format", async () => {
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      [
        'model_provider="poe"',
        `model="${DEFAULT_CODEX_MODEL}"`,
        'model_reasoning_effort="medium"',
        "",
        "[model_providers.poe]",
        'name="poe"',
        'base_url="https://api.poe.com/v1"',
        'wire_api="responses"',
        'experimental_bearer_token="test-key"',
        "",
        "[features]",
        "bar = true",
        ""
      ].join("\n"),
      { encoding: "utf8" }
    );

    const removed = await unconfigureCodex();
    expect(removed).toBe(true);

    const content = await mockFsObj.readFile(configPath, "utf8");
    expect(content.trim()).toBe("[features]\nbar = true");
  });

  it("removes profile-based poe configuration", async () => {
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      [
        "[profiles.opus]",
        'model = "claude-opus-4.6"',
        'model_provider = "poe"',
        'model_reasoning_effort = "high"',
        "",
        "[model_providers.poe]",
        'name = "poe"',
        'base_url = "https://api.poe.com/v1"',
        'wire_api = "responses"',
        'experimental_bearer_token = "test-key"',
        "",
        "[features]",
        "bar = true",
        ""
      ].join("\n"),
      { encoding: "utf8" }
    );

    const removed = await unconfigureCodex();
    expect(removed).toBe(true);

    const content = await mockFsObj.readFile(configPath, "utf8");
    expect(content.trim()).toBe("[features]\nbar = true");
  });

  it("creates timestamped backup when overwriting existing config", async () => {
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(configPath, "legacy-config", { encoding: "utf8" });

    await configureCodex();

    const files = mockFs.files;
    const backupFile = Object.keys(files).find((f) =>
      f.startsWith(`${configPath}.backup-`)
    );
    expect(backupFile).toBeDefined();
    const backupContent = await mockFsObj.readFile(backupFile!, "utf8");
    expect(backupContent).toBe("legacy-config");
    await expect(
      mockFsObj.readFile(path.join(configDir, "auth.json"), "utf8")
    ).rejects.toThrow();
  });

  it("merges codex configuration with existing content", async () => {
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      ['model_provider = "legacy"', "", "[features]", "foo = true", ""].join(
        "\n"
      ),
      { encoding: "utf8" }
    );

    await configureCodex();

    const doc = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    expect(doc["model_provider"]).toBe("poe");
    expect(doc["features"]).toEqual({ foo: true });

    const profiles = doc["profiles"] as Record<string, Record<string, unknown>>;
    const defaultProfileName =
      codexService.deriveCodexProfileName(DEFAULT_CODEX_MODEL);
    const codexProfile = profiles[defaultProfileName];
    expect(codexProfile["model"]).toBe(stripModelNamespace(DEFAULT_CODEX_MODEL));
    expect(codexProfile["model_provider"]).toBe("poe");
    expect(codexProfile["model_reasoning_effort"]).toBe("medium");
    expect(codexProfile["model_verbosity"]).toBe("medium");

    const providers = doc["model_providers"] as Record<string, unknown>;
    expect(providers).toBeDefined();
    const poe = (providers ?? {})["poe"] as Record<string, unknown>;
    expect(poe).toMatchObject({
      name: "poe",
      base_url: "https://api.poe.com/v1",
      wire_api: "responses",
      experimental_bearer_token: "sk-test"
    });

    const files = mockFs.files;
    const backupFile = Object.keys(files).find((f) =>
      f.startsWith(`${configPath}.backup-`)
    );
    expect(backupFile).toBeDefined();
    const backupContent = await mockFsObj.readFile(backupFile!, "utf8");
    expect(backupContent.trim()).toContain('model_provider = "legacy"');
    expect(backupContent.trim()).toContain("[features]");
    await expect(
      mockFsObj.readFile(path.join(configDir, "auth.json"), "utf8")
    ).rejects.toThrow();
  });

  it("runs the Codex CLI health check via runCommand when invoking the provider test", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: '{"type":"text","text":"CODEX_OK"}\n',
      stderr: "",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await codexService.codexService.test?.(context);

    expect(runCommand).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "exec", "Output exactly: CODEX_OK"
      ])
    );
  });

  it("skips the Codex health check during dry runs", async () => {
    const runCommand = vi.fn();
    const { context } = createProviderTestContext(runCommand, { dryRun: true });

    await codexService.codexService.test?.(context);

    expect(runCommand).not.toHaveBeenCalled();
  });

  it("accepts stdout containing the expected marker among other output", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: '{"info":"OpenAI Codex v0.40.0"}\n{"type":"text","text":"CODEX_OK"}\n',
      stderr: "",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(
      codexService.codexService.test?.(context)
    ).resolves.toBeUndefined();
  });

  it("includes stdout and stderr when the health check command fails", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "FAIL_STDOUT\n",
      stderr: "FAIL_STDERR\n",
      exitCode: 1
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(codexService.codexService.test?.(context)).rejects.toThrow(
      /FAIL_STDOUT/
    );
  });

  it("includes stdout and stderr when the health check output is unexpected", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "WRONG\n",
      stderr: "WARN\n",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(codexService.codexService.test?.(context)).rejects.toThrow(
      /CODEX_OK/
    );
  });
});

describe("kimi service", () => {
  let mockFsObj: FileSystem;
  const homeDir = "/home/user";
  const configPath = path.join(homeDir, ".kimi", "config.toml");
  let env = createCliEnvironment({ cwd: homeDir, homeDir });

  const withProviderPrefix = (model: string): string =>
    `${PROVIDER_NAME}/${stripModelNamespace(model)}`;

  const DEFAULT_PROVIDER_MODEL = withProviderPrefix(DEFAULT_KIMI_MODEL);

  it("advertises kimi-cli as an alias", () => {
    expect(kimiService.kimiService.aliases).toContain("kimi-cli");
  });

  beforeEach(() => {
    mockFsObj = createMockFs({}, homeDir);
    env = createCliEnvironment({ cwd: homeDir, homeDir });
  });

  function createProviderTestContext(
    runCommand: ReturnType<typeof vi.fn>,
    options: { dryRun?: boolean } = {}
  ): { context: ProviderContext; logs: string[] } {
    const logs: string[] = [];
    const logger = createLoggerFactory((message) => {
      logs.push(message);
    }).create({
      dryRun: options.dryRun ?? false,
      verbose: true,
      scope: "test:kimi"
    });

    const context = {
      env,
      command: {
        runCommand,
        fs: mockFsObj
      },
      logger,
      async runCheck(check) {
        await check.run({
          isDryRun: logger.context.dryRun,
          runCommand,
          logDryRun: (message) => logger.dryRun(message)
        });
      }
    } as ProviderContext;

    return { context, logs };
  }

  type ConfigureOptions = Parameters<
    typeof kimiService.kimiService.configure
  >[0]["options"];

  const buildConfigureOptions = (
    overrides: Partial<ConfigureOptions> = {}
  ): ConfigureOptions => ({
    env,
    apiKey: "sk-test",
    model: DEFAULT_KIMI_MODEL,
    ...overrides
  });

  type UnconfigureOptions = Parameters<
    typeof kimiService.kimiService.unconfigure
  >[0]["options"];

  const buildUnconfigureOptions = (
    overrides: Partial<UnconfigureOptions> = {}
  ): UnconfigureOptions => ({
    env,
    ...overrides
  });

  async function configureKimi(
    overrides: Partial<ConfigureOptions> = {}
  ): Promise<void> {
    await kimiService.kimiService.configure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildConfigureOptions(overrides)
    });
  }

  async function unconfigureKimi(
    overrides: Partial<UnconfigureOptions> = {}
  ): Promise<boolean> {
    return kimiService.kimiService.unconfigure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildUnconfigureOptions(overrides)
    });
  }

  it("creates the kimi config file with default model", async () => {
    await configureKimi();

    const config = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    expect(config.default_model).toBe(DEFAULT_PROVIDER_MODEL);
    expect(config.providers).toMatchObject({
      [PROVIDER_NAME]: {
        type: "openai_legacy",
        base_url: "https://api.poe.com/v1",
        api_key: "sk-test"
      }
    });
    expect(config.models).toMatchObject({
      [DEFAULT_PROVIDER_MODEL]: {
        provider: PROVIDER_NAME,
        model: stripModelNamespace(DEFAULT_KIMI_MODEL),
        max_context_size: 256000
      }
    });
  });

  it("writes the selected kimi model to the config", async () => {
    const alternate = KIMI_MODELS[KIMI_MODELS.length - 1]!;
    await configureKimi({ model: alternate });

    const config = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    expect(config.default_model).toBe(withProviderPrefix(alternate));
    const models = config.models as Record<string, unknown>;
    expect(models[withProviderPrefix(alternate)]).toEqual({
      provider: PROVIDER_NAME,
      model: stripModelNamespace(alternate),
      max_context_size: 256000
    });
  });

  it("merges with existing config and preserves other providers", async () => {
    await mockFsObj.mkdir(path.dirname(configPath), { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      serializeToml({
        providers: {
          local: {
            type: "openai_legacy",
            base_url: "http://localhost:8080",
            api_key: "local-key"
          }
        },
        models: {
          "local/test-model": {
            provider: "local",
            model: "test-model",
            max_context_size: 4096
          }
        }
      })
    );

    await configureKimi();

    const config = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    const providers = config.providers as Record<string, unknown>;
    const models = config.models as Record<string, unknown>;
    expect(providers.local).toEqual({
      type: "openai_legacy",
      base_url: "http://localhost:8080",
      api_key: "local-key"
    });
    expect(providers[PROVIDER_NAME]).toMatchObject({
      type: "openai_legacy",
      base_url: "https://api.poe.com/v1",
      api_key: "sk-test"
    });
    expect(models["local/test-model"]).toEqual({
      provider: "local",
      model: "test-model",
      max_context_size: 4096
    });
  });

  it("prunes stale poe models while preserving other provider models", async () => {
    await mockFsObj.mkdir(path.dirname(configPath), { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      serializeToml({
        default_model: "poe/Old-Model",
        models: {
          "poe/Old-Model": {
            provider: "poe",
            model: "Old-Model",
            max_context_size: 128000
          },
          "local/test-model": {
            provider: "local",
            model: "test-model",
            max_context_size: 4096
          }
        },
        providers: {
          poe: {
            type: "openai_legacy",
            base_url: "https://api.poe.com/v1",
            api_key: "old-key"
          }
        }
      })
    );

    await configureKimi();

    const config = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    const models = config.models as Record<string, unknown>;

    expect(models["poe/Old-Model"]).toBeUndefined();
    expect(models["local/test-model"]).toBeDefined();

    for (const m of KIMI_MODELS) {
      expect(models[withProviderPrefix(m)]).toBeDefined();
    }
  });

  it("replaces the Poe provider entry while keeping other providers", async () => {
    await mockFsObj.mkdir(path.dirname(configPath), { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      serializeToml({
        providers: {
          poe: {
            type: "openai_legacy",
            base_url: "https://api.poe.com/v1",
            api_key: "old-key"
          },
          openai: {
            type: "openai_legacy",
            base_url: "https://api.openai.com/v1",
            api_key: "openai-key"
          }
        }
      })
    );

    await configureKimi();

    const config = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    const providers = config.providers as Record<string, Record<string, unknown>>;
    expect(providers[PROVIDER_NAME].api_key).toBe("sk-test");
    expect(providers.openai).toEqual({
      type: "openai_legacy",
      base_url: "https://api.openai.com/v1",
      api_key: "openai-key"
    });
  });

  it("spawns the kimi CLI with the provided prompt and args", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "kimi-output\n",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = {
      env: {} as any,
      command: {
        runCommand,
        fs: mockFsObj
      },
      logger: {
        context: { dryRun: false, verbose: true }
      }
    } as unknown as import("../cli/service-registry.js").ProviderContext;

    const result = await kimiService.kimiService.spawn(providerContext, {
      prompt: "List all files",
      args: ["--format", "markdown"]
    });

    expect(runCommand).toHaveBeenCalledWith("kimi", [
      "--quiet",
      "-p",
      "List all files",
      "--format",
      "markdown"
    ]);
    expect(result).toEqual({
      stdout: "kimi-output\n",
      stderr: "",
      exitCode: 0
    });
  });

  it("runs the Kimi health check via runCommand when test is invoked", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: '{"type":"text","text":"KIMI_OK"}\n',
      stderr: "",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await kimiService.kimiService.test?.(context);

    expect(runCommand).toHaveBeenCalledWith(
      "kimi",
      expect.arrayContaining([
        "-p", "Output exactly: KIMI_OK"
      ])
    );
  });

  it("skips the Kimi health check during dry runs", async () => {
    const runCommand = vi.fn();
    const { context } = createProviderTestContext(runCommand, { dryRun: true });

    await kimiService.kimiService.test?.(context);

    expect(runCommand).not.toHaveBeenCalled();
  });

  it("includes stdout and stderr when the Kimi health check command fails", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "KIMI_FAIL_STDOUT\n",
      stderr: "KIMI_FAIL_STDERR\n",
      exitCode: 1
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(
      kimiService.kimiService.test?.(context)
    ).rejects.toThrow(/KIMI_FAIL_STDOUT/);
  });

  it("includes stdout and stderr when the Kimi health check output is unexpected", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "MISCONFIG\n",
      stderr: "ALERT\n",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(
      kimiService.kimiService.test?.(context)
    ).rejects.toThrow(/KIMI_OK/);
  });

  it("removes the Poe provider from config on remove", async () => {
    await configureKimi();

    const before = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    const beforeProviders = before.providers as Record<string, unknown>;
    expect(beforeProviders[PROVIDER_NAME]).toBeDefined();

    const removed = await unconfigureKimi();
    expect(removed).toBe(true);

    const after = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    const afterProviders = after.providers as Record<string, unknown> | undefined;
    expect(afterProviders?.[PROVIDER_NAME]).toBeUndefined();
  });
});

describe("opencode service", () => {
  let mockFsObj: FileSystem;
  const homeDir = "/home/user";
  const configPath = path.join(homeDir, ".config", "opencode", "config.json");
  const authPath = path.join(homeDir, ".local", "share", "opencode", "auth.json");
  let env = createCliEnvironment({ cwd: homeDir, homeDir });

  const withProviderPrefix = (model: string): string =>
    `${PROVIDER_NAME}/${model}`;

  const DEFAULT_PROVIDER_MODEL = withProviderPrefix(DEFAULT_FRONTIER_MODEL);

  beforeEach(() => {
    mockFsObj = createMockFs({}, homeDir);
    env = createCliEnvironment({ cwd: homeDir, homeDir });
  });

  function createProviderTestContext(
    runCommand: ReturnType<typeof vi.fn>,
    options: { dryRun?: boolean } = {}
  ): { context: ProviderContext; logs: string[] } {
    const logs: string[] = [];
    const logger = createLoggerFactory((message) => {
      logs.push(message);
    }).create({
      dryRun: options.dryRun ?? false,
      verbose: true,
      scope: "test:opencode"
    });

    const context = {
      env,
      command: {
        runCommand,
        fs: mockFsObj
      },
      logger,
      async runCheck(check) {
        await check.run({
          isDryRun: logger.context.dryRun,
          runCommand,
          logDryRun: (message) => logger.dryRun(message)
        });
      }
    } as ProviderContext;

    return { context, logs };
  }

  type ConfigureOptions = Parameters<
    typeof opencodeService.openCodeService.configure
  >[0]["options"];

  const buildConfigureOptions = (
    overrides: Partial<ConfigureOptions> = {}
  ): ConfigureOptions => ({
    env,
    apiKey: "sk-test",
    model: DEFAULT_FRONTIER_MODEL,
    ...overrides
  });

  async function configureOpenCode(
    overrides: Partial<ConfigureOptions> = {}
  ): Promise<void> {
    await opencodeService.openCodeService.configure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildConfigureOptions(overrides)
    });
  }

  it("creates the opencode config and auth files", async () => {
    await configureOpenCode();

    const config = JSON.parse(await mockFsObj.readFile(configPath, "utf8"));
    expect(config).toEqual({
      $schema: "https://opencode.ai/config.json",
      model: DEFAULT_PROVIDER_MODEL,
      enabled_providers: [PROVIDER_NAME]
    });

    const auth = JSON.parse(await mockFsObj.readFile(authPath, "utf8"));
    expect(auth).toEqual({
      [PROVIDER_NAME]: {
        type: "api",
        key: "sk-test"
      }
    });
  });

  it("writes the selected frontier model to the config", async () => {
    const alternate = FRONTIER_MODELS[FRONTIER_MODELS.length - 1]!;
    await configureOpenCode({ model: alternate });

    const config = JSON.parse(await mockFsObj.readFile(configPath, "utf8"));
    expect(config.model).toBe(withProviderPrefix(alternate));
  });

  it("offers Gemini 3.1 Pro in configure prompts instead of the removed Gemini 3 Pro", () => {
    const choices =
      opencodeService.openCodeService.configurePrompts?.model?.choices ?? [];
    const values = choices.map((choice) => choice.value);

    expect(values).toContain("google/gemini-3.1-pro");
    expect(values).not.toContain("google/gemini-3-pro");
  });

  it("merges with existing config and preserves other settings", async () => {
    await mockFsObj.mkdir(path.dirname(configPath), { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      JSON.stringify(
        {
          theme: "dark",
          customSetting: true
        },
        null,
        2
      )
    );

    await configureOpenCode();

    const config = JSON.parse(await mockFsObj.readFile(configPath, "utf8"));
    expect(config.theme).toBe("dark");
    expect(config.customSetting).toBe(true);
    expect(config.enabled_providers).toEqual([PROVIDER_NAME]);
    expect(config.$schema).toBe("https://opencode.ai/config.json");
  });

  it("replaces the Poe auth entry while keeping other providers", async () => {
    await mockFsObj.mkdir(path.dirname(authPath), { recursive: true });
    await mockFsObj.writeFile(
      authPath,
      JSON.stringify(
        {
          poe: {
            type: "legacy",
            key: "old-key"
          },
          openai: {
            type: "api",
            key: "openai-key"
          }
        },
        null,
        2
      )
    );

    await configureOpenCode();

    const auth = JSON.parse(await mockFsObj.readFile(authPath, "utf8"));
    expect(auth).toEqual({
      [PROVIDER_NAME]: {
        type: "api",
        key: "sk-test"
      },
      openai: {
        type: "api",
        key: "openai-key"
      }
    });
  });

  it("spawns the opencode CLI with the provided prompt and args", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "opencode-output\n",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = createProviderTestContext(runCommand).context;

    const result = await opencodeService.openCodeService.spawn(providerContext, {
      prompt: "List all files",
      args: ["--format", "markdown"]
    });

    expect(runCommand).toHaveBeenCalledWith("poe-code", [
      "wrap",
      "opencode",
      "--model",
      DEFAULT_PROVIDER_MODEL,
      "run",
      "List all files",
      "--format",
      "markdown"
    ]);
    expect(result).toEqual({
      stdout: "opencode-output\n",
      stderr: "",
      exitCode: 0
    });
  });

  it("spawns the opencode CLI with a custom model", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "opencode-output\n",
      stderr: "",
      exitCode: 0
    }));
    const customModel = FRONTIER_MODELS[FRONTIER_MODELS.length - 1]!;
    const providerContext = createProviderTestContext(runCommand).context;

    await opencodeService.openCodeService.spawn(providerContext, {
      prompt: "List all files",
      model: customModel
    });

    expect(runCommand).toHaveBeenCalledWith("poe-code", [
      "wrap",
      "opencode",
      "--model",
      withProviderPrefix(customModel),
      "run",
      "List all files"
    ]);
  });

  it("avoids duplicating the provider prefix for prefixed models", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "opencode-output\n",
      stderr: "",
      exitCode: 0
    }));
    const prefixed = withProviderPrefix("Custom-Model");
    const providerContext = createProviderTestContext(runCommand).context;

    await opencodeService.openCodeService.spawn(providerContext, {
      prompt: "Describe the change",
      model: prefixed
    });

    expect(runCommand).toHaveBeenCalledWith("poe-code", [
      "wrap",
      "opencode",
      "--model",
      prefixed,
      "run",
      "Describe the change"
    ]);
  });

  it("passes MCP servers as OPENCODE_CONFIG_CONTENT env var", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "opencode-output\n",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = createProviderTestContext(runCommand).context;

    await opencodeService.openCodeService.spawn(providerContext, {
      prompt: "Refactor this",
      mcpServers: {
        "my-server": {
          command: "npx",
          args: ["my-mcp-server", "--port", "3000"],
          env: { API_KEY: "secret" }
        }
      }
    });

    expect(runCommand).toHaveBeenCalledWith(
      "poe-code",
      ["wrap", "opencode", "--model", DEFAULT_PROVIDER_MODEL, "run", "Refactor this"],
      {
        cwd: undefined,
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            mcp: {
              "my-server": {
                type: "local",
                command: ["npx", "my-mcp-server", "--port", "3000"],
                environment: { API_KEY: "secret" }
              }
            }
          })
        }
      }
    );
  });

  it("omits environment key from MCP server entry when env is empty", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = createProviderTestContext(runCommand).context;

    await opencodeService.openCodeService.spawn(providerContext, {
      prompt: "Do something",
      mcpServers: {
        "bare-server": { command: "my-binary" }
      }
    });

    const [, , callOptions] = runCommand.mock.calls[0]!;
    const config = JSON.parse(callOptions.env.OPENCODE_CONFIG_CONTENT);
    expect(config.mcp["bare-server"]).toEqual({
      type: "local",
      command: ["my-binary"]
    });
    expect(config.mcp["bare-server"].environment).toBeUndefined();
  });

  it("runs the OpenCode health check via runCommand when test is invoked", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: '{"type":"text","text":"OPEN_CODE_OK"}\n',
      stderr: "",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await opencodeService.openCodeService.test?.(context);

    expect(runCommand).toHaveBeenCalledWith(
      "opencode",
      expect.arrayContaining([
        "run", "Output exactly: OPEN_CODE_OK"
      ])
    );
  });

  it("skips the OpenCode health check during dry runs", async () => {
    const runCommand = vi.fn();
    const { context } = createProviderTestContext(runCommand, { dryRun: true });

    await opencodeService.openCodeService.test?.(context);

    expect(runCommand).not.toHaveBeenCalled();
  });

  it("includes stdout and stderr when the OpenCode health check command fails", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "OPEN_FAIL_STDOUT\n",
      stderr: "OPEN_FAIL_STDERR\n",
      exitCode: 1
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(
      opencodeService.openCodeService.test?.(context)
    ).rejects.toThrow(/OPEN_FAIL_STDOUT/);
  });

  it("includes stdout and stderr when the OpenCode health check output is unexpected", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "MISCONFIG\n",
      stderr: "ALERT\n",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(
      opencodeService.openCodeService.test?.(context)
    ).rejects.toThrow(/OPEN_CODE_OK/);
  });
});

describe("poe-agent provider", () => {
  beforeEach(() => {
    createAgentSessionMock.mockReset();
    sendMessageMock.mockReset();
    disposeMock.mockReset();

    sendMessageMock.mockImplementation(
      async (
        _prompt: string,
        options?: { onSessionUpdate?: (update: unknown) => void }
      ) => {
        options?.onSessionUpdate?.({
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "run command",
          kind: "execute",
          status: "pending"
        });
        options?.onSessionUpdate?.({
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          kind: "execute",
          status: "in_progress"
        });
        options?.onSessionUpdate?.({
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          kind: "execute",
          status: "completed",
          rawOutput: "ok"
        });
        options?.onSessionUpdate?.({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Poe agent output" }
        });

        return {
          role: "assistant",
          content: "Poe agent output"
        };
      }
    );
    disposeMock.mockResolvedValue(undefined);
    createAgentSessionMock.mockResolvedValue({
      sendMessage: sendMessageMock,
      dispose: disposeMock
    });
  });

  it("declares provider metadata", () => {
    expect(poeAgentProvider.id).toBe("poe-agent");
    expect(poeAgentProvider.name).toBe("poe-agent");
    expect(poeAgentProvider.label).toBe("Poe Agent");
    expect(poeAgentProvider.summary).toBe(
      "Run one-shot prompts with the built-in Poe agent runtime."
    );
    expect(poeAgentProvider.spawn).toBeUndefined();
    expect(poeAgentProvider.supportsMcpSpawn).toBeUndefined();
  });

  it("runs poe-agent via ACP host lifecycle", async () => {
    const initializeSpy = vi.spyOn(AcpClient.prototype, "initialize");
    const newSessionSpy = vi.spyOn(AcpClient.prototype, "newSession");
    const promptSpy = vi.spyOn(AcpClient.prototype, "prompt");

    const { events, done } = spawnPoeAgentWithAcp({
      prompt: "Summarize this diff",
      model: "anthropic/claude-opus-4.6",
      cwd: "/workspace/project",
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });
    const received: unknown[] = [];
    const collectPromise = (async () => {
      for await (const event of events) {
        received.push(event);
      }
    })();
    const result = await done;
    await collectPromise;

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: "anthropic/claude-opus-4.6",
      cwd: "/workspace/project",
      mcpServers: {
        test: {
          transport: "stdio",
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });
    expect(initializeSpy).toHaveBeenCalledTimes(1);
    expect(newSessionSpy).toHaveBeenCalledTimes(1);
    expect(newSessionSpy).toHaveBeenCalledWith("/workspace/project", []);
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy).toHaveBeenCalledWith(
      expect.any(String),
      [{ type: "text", text: "Summarize this diff" }]
    );
    expect(
      initializeSpy.mock.invocationCallOrder[0]
    ).toBeLessThan(newSessionSpy.mock.invocationCallOrder[0]);
    expect(
      newSessionSpy.mock.invocationCallOrder[0]
    ).toBeLessThan(promptSpy.mock.invocationCallOrder[0]);
    expect(sendMessageMock).toHaveBeenCalledWith(
      "Summarize this diff",
      expect.objectContaining({
        onSessionUpdate: expect.any(Function)
      })
    );
    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(received).toEqual([
      { event: "session_start", threadId: "poe-agent-session-1" },
      {
        event: "tool_start",
        kind: "exec",
        title: "run command",
        id: "tool-1"
      },
      {
        event: "tool_complete",
        kind: "exec",
        path: "ok",
        id: "tool-1"
      },
      { event: "agent_message", text: "Poe agent output" }
    ]);
    expect(result).toEqual({
      stdout: "Poe agent output\n",
      stderr: "",
      exitCode: 0,
      threadId: "poe-agent-session-1"
    });

    initializeSpy.mockRestore();
    newSessionSpy.mockRestore();
    promptSpy.mockRestore();
  });

  it("uses default model when none is provided", async () => {
    const { done } = spawnPoeAgentWithAcp({
      prompt: "Explain this function"
    });
    await done;

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: DEFAULT_FRONTIER_MODEL,
      cwd: process.cwd(),
    });
  });

  it("forwards baseUrl override to createAgentSession", async () => {
    const { done } = spawnPoeAgentWithAcp({
      prompt: "Explain this function",
      baseUrl: "http://proxy.example.com/v1",
    });
    await done;

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: DEFAULT_FRONTIER_MODEL,
      cwd: process.cwd(),
      baseUrl: "http://proxy.example.com/v1",
    });
  });
});

describe("determine provider workflow script", () => {
  const scriptPath = "../../scripts/workflows/determine-provider.ts";
  let writes: string[];
  let originalAppend: typeof fs.appendFileSync;

  beforeEach(() => {
    writes = [];
    vi.resetModules();
    originalAppend = fs.appendFileSync;
    fs.appendFileSync = ((_, content: string | NodeJS.ArrayBufferView) => {
      const text =
        typeof content === "string"
          ? content
          : Buffer.isBuffer(content)
          ? content.toString("utf8")
          : String(content);
      writes.push(text);
    }) as typeof fs.appendFileSync;
    process.env.GITHUB_OUTPUT = "/tmp/output";
    process.env.LABEL_NAME = "agent:claude-code";
    process.env.ISSUE_NUMBER = "42";
  });

  afterEach(() => {
    vi.resetModules();
    fs.appendFileSync = originalAppend;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.LABEL_NAME;
    delete process.env.ISSUE_NUMBER;
  });

  it("emits metadata for agent-prefixed labels", async () => {
    await import(scriptPath);
    const output = writes.join("");
    expect(output).toContain("service=claude-code");
    expect(output).toContain("branch=agent/claude-code/issue-42");
    expect(output).toContain("pr_label=agent:claude-code");
  });
});

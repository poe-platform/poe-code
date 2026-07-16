import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { Volume, createFsFromVolume } from "memfs";
import { parse as parseYaml } from "yaml";
import type { FileSystem } from "../utils/file-system.js";
import type { ProviderContext } from "../cli/service-registry.js";
import type { HttpClient } from "../cli/http.js";
import { createCliEnvironment } from "../cli/environment.js";
import { resolveProviderRuntimeEnv } from "../cli/isolated-env.js";
import { createTestCommandContext } from "../../tests/test-command-context.js";
import { createLoggerFactory } from "../cli/logger.js";
import {
  createMockFs,
  parseToml,
  serializeToml,
  type MockFileSystem
} from "@poe-code/config-mutations/testing";
import { createCliContainer } from "../cli/container.js";
import { buildProviderContext, createExecutionResources } from "../cli/commands/shared.js";
import { createProviderStub } from "../../tests/provider-stub.js";
import { getCurrentExecutionContext } from "../utils/execution-context.js";
import * as claudeService from "./claude-code.js";
import * as codexService from "./codex.js";
import * as kimiService from "./kimi.js";
import * as opencodeService from "./opencode.js";
import * as geminiCliService from "./gemini-cli.js";
import * as gooseService from "./goose.js";
import { provider as poeAgentProvider, spawnPoeAgentWithAcp } from "./poe-agent.js";
import { AcpClient } from "@poe-code/poe-acp-client";
import {
  CLAUDE_CODE_VARIANTS,
  stripModelNamespace,
  DEFAULT_KIMI_MODEL,
  DEFAULT_GOOSE_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_REASONING,
  KIMI_MODELS,
  DEFAULT_FRONTIER_MODEL,
  FRONTIER_MODELS,
  PROVIDER_NAME
} from "../cli/constants.js";
import { ValidationError } from "../cli/errors.js";

const createAgentSessionMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());
const disposeMock = vi.hoisted(() => vi.fn());
const getHistoryMock = vi.hoisted(() => vi.fn());
const createAgentSessionStoreMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/poe-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/poe-agent")>();
  return {
    ...actual,
    createAgentSession: createAgentSessionMock,
    createAgentSessionStore: createAgentSessionStoreMock,
    parseNullablePluginConfigEntries: (value: unknown) => value,
    parsePluginConfigEntries: (value: unknown) => value
  };
});

const resolveVariantModel = (variant: keyof typeof CLAUDE_CODE_VARIANTS): string =>
  CLAUDE_CODE_VARIANTS[variant];

const CLAUDE_MODEL_HAIKU = resolveVariantModel("haiku");
const CLAUDE_MODEL_SONNET = resolveVariantModel("sonnet");
const CLAUDE_MODEL_OPUS = resolveVariantModel("opus");
const CODEX_EXPLICIT_MODEL = "openai/gpt-5.4-codex";
const CODEX_EXPLICIT_MODEL_ID = "gpt-5.4-codex";

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
  it("omits non-agent utilities from the registry list", () => {
    const container = createCliContainer({
      fs: createMockFs({}, homeDir),
      prompts: async () => ({}),
      env: { cwd, homeDir },
      logger: () => {}
    });
    const names = container.registry.list().map((adapter) => adapter.name);
    expect(names).not.toContain("pi");
    expect(container.registry.get("pi")).toBeUndefined();
    expect(names).not.toContain("roo-code");
    expect(names).not.toContain("tiny-http-mcp-server");
  });
});

describe("constant pins", () => {
  it("pins the canonical provider id used across configs and templates", () => {
    expect(PROVIDER_NAME).toBe("poe");
  });

  it("pins the default reasoning effort used in passthrough fixtures and assertions", () => {
    expect(DEFAULT_REASONING).toBe("medium");
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
        dryRun: options.dryRun ?? false,
        runCommand,
        runCommandWithEnv(command, args, runOptions) {
          return runCommand(command, args, runOptions);
        },
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

  const buildConfigureOptions = (overrides: Partial<ConfigureOptions> = {}): ConfigureOptions => ({
    env,
    provider: {
      id: PROVIDER_NAME,
      apiShape: "anthropic-messages",
      baseUrl: "https://api.poe.com",
      agentBaseUrl: "https://api.poe.com",
      credential: "sk-test",
      extraEnv: { ANTHROPIC_CUSTOM_HEADERS: "Authorization: Bearer sk-test" }
    },
    model: CLAUDE_MODEL_SONNET,
    ...overrides
  });

  const buildUnconfigureOptions = (
    overrides: Partial<UnconfigureOptions> = {}
  ): UnconfigureOptions => ({
    env,
    ...overrides
  });

  async function configureClaude(overrides: Partial<ConfigureOptions> = {}): Promise<void> {
    await claudeService.claudeCodeService.configure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildConfigureOptions(overrides)
    });
  }

  async function unconfigureClaude(overrides: Partial<UnconfigureOptions> = {}): Promise<boolean> {
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
      env: {
        ANTHROPIC_CUSTOM_HEADERS: "Authorization: Bearer sk-test",
        ANTHROPIC_BASE_URL: "https://api.poe.com"
      },
      model: stripModelNamespace(CLAUDE_MODEL_SONNET).replaceAll(".", "-")
    });
  });

  it("writes the requested reasoning effort as effortLevel", async () => {
    await configureClaude({ reasoningEffort: "low" });

    const parsed = JSON.parse(await mockFsObj.readFile(settingsPath, "utf8"));
    expect(parsed.effortLevel).toBe("low");
  });

  it("leaves effortLevel untouched when no reasoning effort is requested", async () => {
    await mockFsObj.mkdir(path.dirname(settingsPath), { recursive: true });
    await mockFsObj.writeFile(settingsPath, JSON.stringify({ effortLevel: "high" }, null, 2), {
      encoding: "utf8"
    });

    await configureClaude();

    const parsed = JSON.parse(await mockFsObj.readFile(settingsPath, "utf8"));
    expect(parsed.effortLevel).toBe("high");
  });

  it("uses provider.baseUrl override for ANTHROPIC_BASE_URL", async () => {
    await configureClaude({
      provider: {
        id: PROVIDER_NAME,
        apiShape: "anthropic-messages",
        baseUrl: "https://proxy.example.com",
        agentBaseUrl: "https://proxy.example.com",
        credential: "sk-test",
        extraEnv: { ANTHROPIC_CUSTOM_HEADERS: "Authorization: Bearer sk-test" }
      }
    });

    const content = await mockFsObj.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({
      env: {
        ANTHROPIC_CUSTOM_HEADERS: "Authorization: Bearer sk-test",
        ANTHROPIC_BASE_URL: "https://proxy.example.com"
      },
      model: stripModelNamespace(CLAUDE_MODEL_SONNET).replaceAll(".", "-")
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
      theme: "dark",
      env: {
        ANTHROPIC_CUSTOM_HEADERS: "Authorization: Bearer sk-test",
        ANTHROPIC_BASE_URL: "https://api.poe.com",
        CUSTOM: "value"
      },
      model: stripModelNamespace(CLAUDE_MODEL_SONNET).replaceAll(".", "-")
    });
  });

  it("restores overwritten Claude Code settings after unconfigure", async () => {
    const originalSettings = {
      theme: "dark",
      env: {
        ANTHROPIC_API_KEY: "user-key",
        ANTHROPIC_BASE_URL: "https://user.example.test",
        CUSTOM: "keep"
      },
      model: "user-model"
    };
    await mockFsObj.mkdir(path.dirname(settingsPath), { recursive: true });
    await mockFsObj.writeFile(settingsPath, JSON.stringify(originalSettings, null, 2), {
      encoding: "utf8"
    });

    await configureClaude();
    await expect(unconfigureClaude()).resolves.toBe(true);

    expect(JSON.parse(await mockFsObj.readFile(settingsPath, "utf8"))).toEqual(originalSettings);
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
        "-p",
        "Output exactly: CLAUDE_CODE_OK",
        "--model",
        expect.stringContaining("claude-sonnet-4-6")
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

    await expect(claudeService.claudeCodeService.test?.(context)).rejects.toThrow(/FAIL_STDOUT/);
  });

  it("includes stdout and stderr when the Claude health check output is unexpected", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "WRONG\n",
      stderr: "WARN\n",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(claudeService.claudeCodeService.test?.(context)).rejects.toThrow(/CLAUDE_CODE_OK/);
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
        dryRun: options.dryRun ?? false,
        runCommand,
        runCommandWithEnv(command, args, runOptions) {
          return runCommand(command, args, runOptions);
        },
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

  type ConfigureOptions = Parameters<typeof codexService.codexService.configure>[0]["options"];

  type UnconfigureOptions = Parameters<typeof codexService.codexService.unconfigure>[0]["options"];

  const buildConfigureOptions = (overrides: Partial<ConfigureOptions> = {}): ConfigureOptions => ({
    env,
    provider: {
      id: PROVIDER_NAME,
      apiShape: "openai-responses",
      baseUrl: "https://api.poe.com/v1",
      credential: "sk-test",
      extraEnv: {}
    },
    ...overrides
  });

  const buildUnconfigureOptions = (
    overrides: Partial<UnconfigureOptions> = {}
  ): UnconfigureOptions => ({
    env,
    ...overrides
  });

  async function configureCodex(overrides: Partial<ConfigureOptions> = {}): Promise<void> {
    await codexService.codexService.configure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildConfigureOptions(overrides)
    });
  }

  async function configureCodexWithCommand(
    runCommand: ReturnType<typeof vi.fn>,
    overrides: Partial<ConfigureOptions> = {}
  ): Promise<void> {
    const command = createTestCommandContext(mockFsObj);
    command.runCommand = runCommand;
    command.runCommandWithEnv = (commandName, args, options) =>
      runCommand(commandName, args, options);
    await codexService.codexService.configure({
      fs: mockFsObj,
      env,
      command,
      options: buildConfigureOptions(overrides)
    });
  }

  async function unconfigureCodex(overrides: Partial<UnconfigureOptions> = {}): Promise<boolean> {
    return codexService.codexService.unconfigure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildUnconfigureOptions(overrides)
    });
  }

  it("writes codex provider config without a default model", async () => {
    await configureCodex({
      timestamp: () => "20240101T000000"
    });

    const doc = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    expect(doc["model_provider"]).toBe("poe");
    expect(doc["model"]).toBeUndefined();
    expect(doc["model_reasoning_effort"]).toBeUndefined();
    expect(doc["model_verbosity"]).toBeUndefined();
    expect(doc["profiles"]).toBeUndefined();

    const providers = doc["model_providers"] as Record<string, Record<string, unknown>>;
    expect(providers["poe"]["experimental_bearer_token"]).toBe("sk-test");
    expect(providers["poe"]["requires_openai_auth"]).toBe(false);
    expect(providers["poe"]["supports_websockets"]).toBe(false);

    await expect(mockFsObj.readFile(path.join(configDir, "auth.json"), "utf8")).rejects.toThrow();

    await expect(
      mockFsObj.readFile(`${configPath}.backup.20240101T000000`, "utf8")
    ).rejects.toThrow();
  });

  it("writes Codex built-in OpenAI config and logs in with stdin API key", async () => {
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await configureCodexWithCommand(runCommand, {
      provider: {
        id: "openai",
        apiShape: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        credential: "sk-openai-test",
        extraEnv: {}
      }
    });

    const doc = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    expect(doc["model_provider"]).toBe("openai");
    expect(doc["forced_login_method"]).toBe("api");
    expect(doc["model"]).toBeUndefined();
    expect(doc["model_reasoning_effort"]).toBeUndefined();
    expect(doc["model_verbosity"]).toBeUndefined();
    expect(doc["model_providers"]).toBeUndefined();
    expect(runCommand).toHaveBeenCalledWith(
      "codex",
      ["login", "--with-api-key"],
      {
        env: { CODEX_HOME: configDir },
        stdin: "sk-openai-test"
      }
    );
    expect(runCommand.mock.calls.flatMap((call) => call[1])).not.toContain("sk-openai-test");
  });

  it("restores overwritten Codex selection after unconfigure", async () => {
    const original = 'model_provider = "user-provider"\nmodel = "user-model"\n';
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(configPath, original, { encoding: "utf8" });

    await configureCodex();
    await expect(unconfigureCodex()).resolves.toBe(true);

    await expect(mockFsObj.readFile(configPath, "utf8")).resolves.toBe(original);
  });

  it("restores the original Codex selection after repeated configure", async () => {
    const original = 'model_provider = "user-provider"\nmodel = "user-model"\n';
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(configPath, original, { encoding: "utf8" });

    await configureCodex();
    await configureCodex({ model: "anthropic/claude-opus-4.7" });
    await expect(unconfigureCodex()).resolves.toBe(true);

    await expect(mockFsObj.readFile(configPath, "utf8")).resolves.toBe(original);
  });

  it("writes freeform provider model as the active codex default", async () => {
    await configureCodex({
      provider: {
        id: "cloudflare",
        apiShape: "openai-responses",
        baseUrl: "https://gateway.ai.cloudflare.com/v1/account/gateway/openai",
        credential: "cfut_test",
        modelInput: { kind: "freeform" },
        extraEnv: {}
      },
      model: "iris-alpha"
    });

    const doc = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    expect(doc["model_provider"]).toBe("cloudflare");
    expect(doc["model"]).toBe("iris-alpha");
    expect(doc["model_reasoning_effort"]).toBeUndefined();
    expect(doc["model_verbosity"]).toBeUndefined();

    const profiles = doc["profiles"] as Record<string, Record<string, unknown>>;
    const irisProfile = profiles["iris-alpha"];
    expect(irisProfile["model"]).toBe("iris-alpha");
    expect(irisProfile["model_provider"]).toBe("cloudflare");
    expect(irisProfile["model_reasoning_effort"]).toBeUndefined();
  });

  it("writes opus model as opus profile", async () => {
    await configureCodex({
      model: "anthropic/claude-opus-4.7",
      reasoningEffort: "high"
    });

    const doc = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    const profiles = doc["profiles"] as Record<string, Record<string, unknown>>;
    const opusProfile = profiles["opus"];
    expect(opusProfile["model"]).toBe("claude-opus-4.7");
    expect(opusProfile["model_provider"]).toBe("poe");
    expect(opusProfile["model_reasoning_effort"]).toBe("high");
  });

  it("replaces stale profile when reconfiguring with a different model", async () => {
    await configureCodex({ model: CODEX_EXPLICIT_MODEL });

    await configureCodex({
      model: "anthropic/claude-opus-4.7",
      reasoningEffort: "high"
    });

    const doc = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    const profiles = doc["profiles"] as Record<string, Record<string, unknown>>;
    const defaultProfileName = codexService.deriveCodexProfileName(CODEX_EXPLICIT_MODEL);
    expect(profiles["opus"]).toBeDefined();
    expect(profiles[defaultProfileName]).toBeUndefined();
  });

  it("uses provider.baseUrl when writing base_url", async () => {
    await configureCodex({
      provider: {
        id: PROVIDER_NAME,
        apiShape: "openai-responses",
        baseUrl: "https://proxy.example.com/v1",
        credential: "sk-test",
        extraEnv: {}
      }
    });

    const doc = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    const providers = doc["model_providers"] as Record<string, unknown>;
    const poe = providers["poe"] as Record<string, unknown>;
    expect(poe.base_url).toBe("https://proxy.example.com/v1");
  });

  it("restores the generated backup and ignores legacy backup naming", async () => {
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(configPath, "original", { encoding: "utf8" });

    await configureCodex({
      timestamp: () => "20240101T000000"
    });

    await mockFsObj.writeFile(`${configPath}.backup.20240101T000000`, "legacy", {
      encoding: "utf8"
    });
    const removed = await unconfigureCodex();
    expect(removed).toBe(true);

    await expect(mockFsObj.readFile(configPath, "utf8")).resolves.toBe("original");
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

  it("does not remove an absent prototype-named provider", async () => {
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(configPath, "[model_providers]\n", {
      encoding: "utf8"
    });

    const removed = await codexService.codexService.unconfigure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: {
        env,
        provider: { id: "constructor" }
      }
    });

    expect(removed).toBe(false);
    await expect(mockFsObj.readFile(configPath, "utf8")).resolves.toBe("[model_providers]\n");
  });

  it("removes codex block with different formatting", async () => {
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      [
        'model_provider="poe"',
        `model="${CODEX_EXPLICIT_MODEL_ID}"`,
        'model_reasoning_effort="medium"',
        'model_verbosity="medium"',
        "",
        "[model_providers.poe]",
        'name="poe"',
        'base_url="https://api.poe.com/v1"',
        'wire_api="chat"',
        'env_key="OPENAI_API_KEY"',
        'experimental_bearer_token="OPENAI_API_KEY"',
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
        `model="${CODEX_EXPLICIT_MODEL_ID}"`,
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
        `model="${CODEX_EXPLICIT_MODEL_ID}"`,
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
        'model = "claude-opus-4.7"',
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
    const backupFile = Object.keys(files).find((f) => f.startsWith(`${configPath}.backup-`));
    expect(backupFile).toBeDefined();
    const backupContent = await mockFsObj.readFile(backupFile!, "utf8");
    expect(backupContent).toBe("legacy-config");
    await expect(mockFsObj.readFile(path.join(configDir, "auth.json"), "utf8")).rejects.toThrow();
  });

  it("merges codex configuration with existing content", async () => {
    await mockFsObj.mkdir(configDir, { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      ['model_provider = "legacy"', "", "[features]", "foo = true", ""].join("\n"),
      { encoding: "utf8" }
    );

    await configureCodex();

    const doc = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    expect(doc["model_provider"]).toBe("poe");
    expect(doc["model"]).toBeUndefined();
    expect(doc["features"]).toEqual({ foo: true });
    expect(doc["profiles"]).toBeUndefined();

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
    const backupFile = Object.keys(files).find((f) => f.startsWith(`${configPath}.backup-`));
    expect(backupFile).toBeDefined();
    const backupContent = await mockFsObj.readFile(backupFile!, "utf8");
    expect(backupContent.trim()).toContain('model_provider = "legacy"');
    expect(backupContent.trim()).toContain("[features]");
    await expect(mockFsObj.readFile(path.join(configDir, "auth.json"), "utf8")).rejects.toThrow();
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
      expect.arrayContaining(["exec", "Output exactly: CODEX_OK"])
    );
  });

  it("routes Codex hook bridge health checks through poe-code spawn", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "CODEX_OK\n",
      stderr: "",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);
    context.hooks = { from: "claude-code", strategy: "transform" };

    await codexService.codexService.test?.(context);

    // The hook bridge re-invokes this CLI through the resolved host command
    // rather than a bare "poe-code" on PATH, so derive the expectation the same way.
    const host = getCurrentExecutionContext(import.meta.url).command;

    expect(runCommand).toHaveBeenCalledWith(
      host.command,
      expect.arrayContaining([
        ...host.args,
        "spawn",
        "--hooks-from",
        "claude-code",
        "codex"
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

    await expect(codexService.codexService.test?.(context)).resolves.toBeUndefined();
  });

  it("includes stdout and stderr when the health check command fails", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "FAIL_STDOUT\n",
      stderr: "FAIL_STDERR\n",
      exitCode: 1
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(codexService.codexService.test?.(context)).rejects.toThrow(/FAIL_STDOUT/);
  });

  it("includes stdout and stderr when the health check output is unexpected", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "WRONG\n",
      stderr: "WARN\n",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(codexService.codexService.test?.(context)).rejects.toThrow(/CODEX_OK/);
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

  type ConfigureOptions = Parameters<typeof kimiService.kimiService.configure>[0]["options"];

  const buildConfigureOptions = (overrides: Partial<ConfigureOptions> = {}): ConfigureOptions => ({
    env,
    provider: {
      id: PROVIDER_NAME,
      apiShape: "openai-chat-completions",
      baseUrl: "https://api.poe.com/v1",
      credential: "sk-test",
      extraEnv: {}
    },
    model: DEFAULT_KIMI_MODEL,
    ...overrides
  });

  type UnconfigureOptions = Parameters<typeof kimiService.kimiService.unconfigure>[0]["options"];

  const buildUnconfigureOptions = (
    overrides: Partial<UnconfigureOptions> = {}
  ): UnconfigureOptions => ({
    env,
    ...overrides
  });

  async function configureKimi(overrides: Partial<ConfigureOptions> = {}): Promise<void> {
    await kimiService.kimiService.configure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildConfigureOptions(overrides)
    });
  }

  async function unconfigureKimi(overrides: Partial<UnconfigureOptions> = {}): Promise<boolean> {
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

  it("preserves user-created Poe-prefixed models while reconfiguring", async () => {
    await mockFsObj.mkdir(path.dirname(configPath), { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      serializeToml({
        models: {
          "poe/user-custom": {
            provider: "custom-poe",
            model: "user-custom",
            max_context_size: 12345
          },
          "external/keep": {
            provider: "external",
            model: "keep",
            max_context_size: 67890
          }
        }
      })
    );

    await configureKimi();

    const config = parseToml(await mockFsObj.readFile(configPath, "utf8"));
    const models = config.models as Record<string, unknown>;
    expect(models["poe/user-custom"]).toBeDefined();
    expect(models["external/keep"]).toBeDefined();
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
      expect.arrayContaining(["-p", "Output exactly: KIMI_OK"])
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

    await expect(kimiService.kimiService.test?.(context)).rejects.toThrow(/KIMI_FAIL_STDOUT/);
  });

  it("includes stdout and stderr when the Kimi health check output is unexpected", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "MISCONFIG\n",
      stderr: "ALERT\n",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(kimiService.kimiService.test?.(context)).rejects.toThrow(/KIMI_OK/);
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
    expect(after.default_model).toBeUndefined();
    expect(after.default_thinking).toBeUndefined();
    expect(after.models).toBeUndefined();
    await expect(
      mockFsObj.readFile(path.join(homeDir, ".kimi", "credentials", "kimi-code.json"), "utf8")
    ).rejects.toThrow();
  });
});

describe("opencode service", () => {
  let mockFsObj: FileSystem;
  const homeDir = "/home/user";
  const configPath = path.join(homeDir, ".config", "opencode", "config.json");
  const authPath = path.join(homeDir, ".local", "share", "opencode", "auth.json");
  let env = createCliEnvironment({ cwd: homeDir, homeDir });

  const withProviderPrefix = (model: string): string => `${PROVIDER_NAME}/${model}`;

  const DEFAULT_PROVIDER_MODEL = withProviderPrefix(DEFAULT_FRONTIER_MODEL);

  beforeEach(() => {
    mockFsObj = createMockFs({}, homeDir);
    env = createCliEnvironment({ cwd: homeDir, homeDir });
  });

  function createProviderTestContext(
    runCommand: ReturnType<typeof vi.fn>,
    options: { dryRun?: boolean; model?: string } = {}
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
      model: options.model,
      activeProvider: {
        id: PROVIDER_NAME,
        apiShape: "openai-chat-completions",
        baseUrl: "https://api.poe.com/v1",
        credential: "sk-test",
        extraEnv: {}
      },
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

  const buildConfigureOptions = (overrides: Partial<ConfigureOptions> = {}): ConfigureOptions => ({
    env,
    provider: {
      id: PROVIDER_NAME,
      apiShape: "openai-chat-completions",
      baseUrl: "https://api.poe.com/v1",
      credential: "sk-test",
      extraEnv: {}
    },
    model: DEFAULT_FRONTIER_MODEL,
    ...overrides
  });

  async function configureOpenCode(overrides: Partial<ConfigureOptions> = {}): Promise<void> {
    await opencodeService.openCodeService.configure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildConfigureOptions(overrides)
    });
  }

  async function unconfigureOpenCode(): Promise<boolean> {
    return opencodeService.openCodeService.unconfigure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: { env }
    });
  }

  function createOpenCodeHealthRunner(response: {
    stdout?: string;
    stderr?: string;
    exitCode: number;
  }): ReturnType<typeof vi.fn> {
    return vi.fn(async (command: string, args: string[]) => {
      if (command === "git" && args.includes("rev-parse")) {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      if (command === "git" && args.includes("init")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "opencode") {
        return {
          stdout: response.stdout ?? "",
          stderr: response.stderr ?? "",
          exitCode: response.exitCode
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
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
    const choices = opencodeService.openCodeService.configurePrompts?.model?.choices ?? [];
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

  it("preserves existing enabled providers while enabling Poe", async () => {
    await mockFsObj.mkdir(path.dirname(configPath), { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      JSON.stringify({ enabled_providers: ["local", "anthropic"] }, null, 2)
    );

    await configureOpenCode();

    const config = JSON.parse(await mockFsObj.readFile(configPath, "utf8"));
    expect(config.enabled_providers).toEqual(["local", "anthropic", PROVIDER_NAME]);
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

  it("removes Poe model and auth configuration on remove", async () => {
    await mockFsObj.mkdir(path.dirname(configPath), { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      JSON.stringify({ theme: "dark", enabled_providers: ["local"] }, null, 2),
      { encoding: "utf8" }
    );
    await configureOpenCode();

    const removed = await unconfigureOpenCode();
    expect(removed).toBe(true);

    const config = JSON.parse(await mockFsObj.readFile(configPath, "utf8"));
    expect(config.theme).toBe("dark");
    expect(config.model).toBeUndefined();
    expect(config.enabled_providers).toEqual(["local"]);
    await expect(mockFsObj.readFile(authPath, "utf8")).rejects.toThrow();
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

    expect(runCommand).toHaveBeenCalledWith(
      "opencode",
      ["--model", DEFAULT_PROVIDER_MODEL, "run", "List all files", "--format", "markdown"],
      expect.objectContaining({
        env: expect.any(Object)
      })
    );
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

    expect(runCommand).toHaveBeenCalledWith(
      "opencode",
      ["--model", withProviderPrefix(customModel), "run", "List all files"],
      expect.objectContaining({
        env: expect.any(Object)
      })
    );
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

    expect(runCommand).toHaveBeenCalledWith(
      "opencode",
      ["--model", prefixed, "run", "Describe the change"],
      expect.objectContaining({
        env: expect.any(Object)
      })
    );
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
      "opencode",
      ["--model", DEFAULT_PROVIDER_MODEL, "run", "Refactor this"],
      expect.objectContaining({
        cwd: undefined,
        env: expect.objectContaining({
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            mcp: {
              "my-server": {
                type: "local",
                command: ["npx", "my-mcp-server", "--port", "3000"],
                environment: { API_KEY: "secret" }
              }
            }
          })
        })
      })
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
    const runCommand = createOpenCodeHealthRunner({
      stdout: '{"type":"text","text":"OPEN_CODE_OK"}\n',
      stderr: "",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);
    const healthDir = path.join(homeDir, ".poe-code", "opencode-health");

    await opencodeService.openCodeService.test?.(context);

    expect(runCommand).toHaveBeenCalledWith("git", [
      "-C",
      healthDir,
      "rev-parse",
      "--is-inside-work-tree"
    ]);
    expect(runCommand).toHaveBeenCalledWith("git", ["-C", healthDir, "init", "-q"]);
    expect(runCommand).toHaveBeenCalledWith("opencode", [
      "run",
      "Output exactly: OPEN_CODE_OK",
      "--pure",
      "--format",
      "json",
      "--model",
      DEFAULT_PROVIDER_MODEL,
      "--dir",
      healthDir
    ]);
  });

  it("skips the OpenCode health check during dry runs", async () => {
    const runCommand = vi.fn();
    const { context } = createProviderTestContext(runCommand, { dryRun: true });

    await opencodeService.openCodeService.test?.(context);

    expect(runCommand).not.toHaveBeenCalled();
  });

  it("includes stdout and stderr when the OpenCode health check command fails", async () => {
    const runCommand = createOpenCodeHealthRunner({
      stdout: "OPEN_FAIL_STDOUT\n",
      stderr: "OPEN_FAIL_STDERR\n",
      exitCode: 1
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(opencodeService.openCodeService.test?.(context)).rejects.toThrow(
      /OPEN_FAIL_STDOUT/
    );
  });

  it("includes stdout and stderr when the OpenCode health check output is unexpected", async () => {
    const runCommand = createOpenCodeHealthRunner({
      stdout: "MISCONFIG\n",
      stderr: "ALERT\n",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await expect(opencodeService.openCodeService.test?.(context)).rejects.toThrow(/OPEN_CODE_OK/);
  });

  const MODEL_NOT_FOUND_STDERR = [
    "Model not found: poe/anthropic/claude-haiku-4.5. Did you mean: opencode?",
    "ProviderModelNotFoundError: Model not found",
    "    at <anonymous> (/opt/opencode/node_modules/effect/dist/index.js:1:1)",
    "    at bun:main:1:1"
  ].join("\n");

  async function captureTestError(context: ProviderContext): Promise<unknown> {
    return opencodeService.openCodeService.test?.(context).then(
      () => undefined,
      (error: unknown) => error
    );
  }

  it("raises a clean user error echoing the resolved model id when OpenCode cannot find it", async () => {
    const runCommand = createOpenCodeHealthRunner({
      stdout: "",
      stderr: MODEL_NOT_FOUND_STDERR,
      exitCode: 1
    });
    const { context } = createProviderTestContext(runCommand, {
      model: "anthropic/claude-haiku-4.5"
    });

    const error = await captureTestError(context);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).isUserError).toBe(true);
    const message = (error as Error).message;
    expect(message).toContain(withProviderPrefix("anthropic/claude-haiku-4.5"));
    expect(message).toContain("poe-code models");
    expect(message).toContain("poe-code configure opencode");
  });

  it("omits the raw agent stack from the OpenCode model-not-found error", async () => {
    const runCommand = createOpenCodeHealthRunner({
      stdout: "",
      stderr: MODEL_NOT_FOUND_STDERR,
      exitCode: 1
    });
    const { context } = createProviderTestContext(runCommand, {
      model: "anthropic/claude-haiku-4.5"
    });

    const message = ((await captureTestError(context)) as Error).message;

    expect(message).not.toContain("ProviderModelNotFoundError");
    expect(message).not.toContain("at bun:main");
    expect(message).not.toContain("effect/dist");
  });

  it("maps a model-not-found reported on stdout with a zero exit code", async () => {
    const runCommand = createOpenCodeHealthRunner({
      stdout: 'Model not found: poe/anthropic/claude-haiku-4.5\nProviderModelNotFoundError\n',
      stderr: "",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand, {
      model: "anthropic/claude-haiku-4.5"
    });

    const error = await captureTestError(context);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain(withProviderPrefix("anthropic/claude-haiku-4.5"));
  });
});

describe("gemini-cli service", () => {
  let mockFsObj: FileSystem;
  const homeDir = "/home/user";
  const settingsPath = path.join(homeDir, ".gemini", "settings.json");
  let env = createCliEnvironment({ cwd: homeDir, homeDir });

  beforeEach(() => {
    mockFsObj = createMockFs({}, homeDir);
    env = createCliEnvironment({ cwd: homeDir, homeDir });
  });

  it("declares runtime env so non-isolated runs receive the provider credential", () => {
    expect(geminiCliService.provider.runtimeEnv).toEqual({
      GEMINI_API_KEY: { kind: "providerCredential" },
      GOOGLE_GEMINI_BASE_URL: { kind: "providerBaseUrl" }
    });
  });

  it("resolves the active provider credential and base URL into the Gemini runtime env", async () => {
    await expect(
      resolveProviderRuntimeEnv(
        env,
        geminiCliService.provider.runtimeEnv!,
        "gemini-cli",
        buildConfigureOptions().provider
      )
    ).resolves.toEqual({
      GEMINI_API_KEY: "sk-test",
      GOOGLE_GEMINI_BASE_URL: "https://gateway.example.com/google-ai-studio"
    });
  });

  it("declares Gemini wrapper capabilities and isolated environment", () => {
    expect(geminiCliService.provider.supportsStdinPrompt).toBe(true);
    expect(geminiCliService.provider.supportsMcpSpawn).toBe(true);
    expect(geminiCliService.provider.isolatedEnv).toEqual({
      agentBinary: "gemini",
      configProbe: { kind: "isolatedFile", relativePath: "settings.json" },
      env: {
        GEMINI_API_KEY: { kind: "providerCredential" },
        GOOGLE_GEMINI_BASE_URL: { kind: "providerBaseUrl" },
        GEMINI_SANDBOX: "false",
        HOME: { kind: "isolatedDir" }
      }
    });
  });

  type ConfigureOptions = Parameters<
    typeof geminiCliService.geminiCliService.configure
  >[0]["options"];

  type UnconfigureOptions = Parameters<
    typeof geminiCliService.geminiCliService.unconfigure
  >[0]["options"];

  const buildConfigureOptions = (overrides: Partial<ConfigureOptions> = {}): ConfigureOptions => ({
    env,
    provider: {
      id: "cloudflare",
      apiShape: "google-generations",
      baseUrl: "https://gateway.example.com/google-ai-studio",
      credential: "sk-test",
      extraEnv: {}
    },
    model: "gemini-3.1-pro",
    ...overrides
  });

  const buildUnconfigureOptions = (
    overrides: Partial<UnconfigureOptions> = {}
  ): UnconfigureOptions => ({
    env,
    ...overrides
  });

  async function configureGemini(overrides: Partial<ConfigureOptions> = {}): Promise<void> {
    await geminiCliService.geminiCliService.configure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildConfigureOptions(overrides)
    });
  }

  async function unconfigureGemini(overrides: Partial<UnconfigureOptions> = {}): Promise<boolean> {
    return geminiCliService.geminiCliService.unconfigure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildUnconfigureOptions(overrides)
    });
  }

  function createGeminiTestContext(runCommand: ReturnType<typeof vi.fn>): ProviderContext {
    const logger = createLoggerFactory(() => {}).create({
      dryRun: false,
      verbose: true,
      scope: "test:gemini"
    });
    return {
      env,
      model: "gemini-3-pro-preview",
      command: { runCommand, fs: mockFsObj },
      logger,
      async runCheck(check) {
        await check.run({ isDryRun: false, runCommand });
      }
    };
  }

  it("creates Gemini settings for API key auth", async () => {
    await configureGemini();

    expect(JSON.parse(await mockFsObj.readFile(settingsPath, "utf8"))).toMatchInlineSnapshot(`
      {
        "mcpServers": {},
        "model": {
          "name": "gemini-3.1-pro",
        },
        "security": {
          "auth": {
            "selectedType": "gemini-api-key",
          },
        },
      }
    `);
  });

  it("merges Gemini settings, migrates prior managed keys, and preserves user keys", async () => {
    await mockFsObj.mkdir(path.dirname(settingsPath), { recursive: true });
    await mockFsObj.writeFile(
      settingsPath,
      JSON.stringify(
        {
          theme: "dark",
          selectedAuthType: "gemini-api-key",
          model: "gemini-2.5-pro",
          mcpServers: {
            local: {
              command: "node",
              args: ["server.js"]
            }
          }
        },
        null,
        2
      )
    );

    await configureGemini({ model: "gemini-2.5-flash" });

    const settings = JSON.parse(await mockFsObj.readFile(settingsPath, "utf8"));
    expect(settings).toEqual({
      theme: "dark",
      security: { auth: { selectedType: "gemini-api-key" } },
      model: { name: "gemini-2.5-flash" },
      mcpServers: {
        local: {
          command: "node",
          args: ["server.js"]
        }
      }
    });
    const backupPath = Object.keys(mockFsObj.files).find((filePath) =>
      filePath.startsWith(`${settingsPath}.backup-`)
    );
    expect(backupPath).toBeDefined();
    await expect(mockFsObj.readFile(backupPath!, "utf8")).resolves.toContain('"theme": "dark"');
  });

  it("resolves Gemini model choices from the active provider models endpoint", async () => {
    const httpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3-pro-preview", supportedGenerationMethods: ["generateContent"] },
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }
        ]
      })
    })) satisfies HttpClient;
    const choices = geminiCliService.geminiCliService.configurePrompts?.model?.choices;

    expect(typeof choices).toBe("function");
    if (typeof choices !== "function") {
      throw new Error("Expected Gemini model choices resolver.");
    }

    const resolvedChoices = await choices({
      httpClient,
      provider: {
        id: "cloudflare",
        apiShape: "google-generations",
        baseUrl: "https://gateway.example.com/google-ai-studio",
        credential: "cf-token",
        extraEnv: {}
      },
      env
    });
    expect(resolvedChoices).toEqual([
      { title: "gemini-2.5-pro", value: "gemini-2.5-pro" },
      { title: "gemini-2.5-flash", value: "gemini-2.5-flash" },
      { title: "gemini-3-pro-preview", value: "gemini-3-pro-preview" }
    ]);
    expect(httpClient).toHaveBeenCalledWith(
      "https://gateway.example.com/google-ai-studio/v1beta/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer cf-token"
        })
      })
    );
    await configureGemini({ model: resolvedChoices[2]!.value });
    expect(JSON.parse(await mockFsObj.readFile(settingsPath, "utf8"))).toMatchInlineSnapshot(`
      {
        "mcpServers": {},
        "model": {
          "name": "gemini-3-pro-preview",
        },
        "security": {
          "auth": {
            "selectedType": "gemini-api-key",
          },
        },
      }
    `);
  });

  it("uses fallback Gemini model choices when model discovery fails", async () => {
    const httpClient = vi
      .fn()
      .mockRejectedValue(new Error("gateway unavailable")) satisfies HttpClient;
    const choices = geminiCliService.geminiCliService.configurePrompts?.model?.choices;
    expect(typeof choices).toBe("function");
    if (typeof choices !== "function") throw new Error("Expected Gemini model choices resolver.");

    await expect(
      choices({ httpClient, provider: buildConfigureOptions().provider, env })
    ).resolves.toEqual([
      { title: "gemini-2.5-pro", value: "gemini-2.5-pro" },
      { title: "gemini-2.5-flash", value: "gemini-2.5-flash" },
      { title: "gemini-3-pro-preview", value: "gemini-3-pro-preview" },
      { title: "gemini-3-flash-preview", value: "gemini-3-flash-preview" }
    ]);
    await expect(configureGemini({ model: DEFAULT_GEMINI_MODEL })).resolves.toBeUndefined();
  });

  it("uses fallback Gemini model choices when discovery returns no usable models", async () => {
    const httpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ displayName: "Missing name" }] })
    })) satisfies HttpClient;
    const choices = geminiCliService.geminiCliService.configurePrompts?.model?.choices;
    expect(typeof choices).toBe("function");
    if (typeof choices !== "function") throw new Error("Expected Gemini model choices resolver.");

    await expect(
      choices({ httpClient, provider: buildConfigureOptions().provider, env })
    ).resolves.toEqual([
      { title: "gemini-2.5-pro", value: "gemini-2.5-pro" },
      { title: "gemini-2.5-flash", value: "gemini-2.5-flash" },
      { title: "gemini-3-pro-preview", value: "gemini-3-pro-preview" },
      { title: "gemini-3-flash-preview", value: "gemini-3-flash-preview" }
    ]);
  });

  it("tests Gemini availability and health with sandbox disabled through environment", async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "/usr/local/bin/gemini\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "GEMINI_OK\n", stderr: "", exitCode: 0 });
    await geminiCliService.geminiCliService.test?.(createGeminiTestContext(runCommand));
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "gemini",
      ["-p", "say GEMINI_OK", "--output-format", "text", "--model", "gemini-3-pro-preview"],
      { env: { GEMINI_SANDBOX: "false" } }
    );
  });

  it("unconfigures only Gemini-managed settings", async () => {
    await mockFsObj.mkdir(path.dirname(settingsPath), { recursive: true });
    await mockFsObj.writeFile(
      settingsPath,
      JSON.stringify(
        {
          theme: "dark",
          security: { auth: { selectedType: "gemini-api-key", useExternal: false } },
          model: { name: "gemini-3.1-pro", maxSessionTurns: 10 },
          mcpServers: {
            local: {
              command: "node",
              args: ["server.js"]
            }
          }
        },
        null,
        2
      )
    );

    const removed = await unconfigureGemini();

    const settings = JSON.parse(await mockFsObj.readFile(settingsPath, "utf8"));
    expect(removed).toBe(true);
    expect(settings).toEqual({
      theme: "dark",
      security: { auth: { useExternal: false } },
      model: { maxSessionTurns: 10 },
      mcpServers: {
        local: {
          command: "node",
          args: ["server.js"]
        }
      }
    });
    await expect(unconfigureGemini()).resolves.toBe(false);
  });

  it("restores backed-up Gemini settings after unconfigure", async () => {
    const originalSettings = {
      theme: "dark",
      security: { auth: { selectedType: "oauth-personal" } },
      model: { name: "user-model" },
      mcpServers: { local: { command: "node", args: ["server.js"] } }
    };
    await mockFsObj.mkdir(path.dirname(settingsPath), { recursive: true });
    await mockFsObj.writeFile(settingsPath, JSON.stringify(originalSettings, null, 2), {
      encoding: "utf8"
    });

    await configureGemini();
    await expect(unconfigureGemini()).resolves.toBe(true);

    expect(JSON.parse(await mockFsObj.readFile(settingsPath, "utf8"))).toEqual(originalSettings);
    await expect(unconfigureGemini()).resolves.toBe(false);
  });

  it("leaves unrelated Gemini user settings untouched when unconfiguring", async () => {
    const userSettings = {
      theme: "dark",
      security: { auth: { selectedType: "oauth-personal" } },
      model: { name: "user-selected-model" },
      mcpServers: {}
    };
    await mockFsObj.mkdir(path.dirname(settingsPath), { recursive: true });
    await mockFsObj.writeFile(settingsPath, JSON.stringify(userSettings, null, 2));

    await expect(unconfigureGemini()).resolves.toBe(false);
    await expect(mockFsObj.readFile(settingsPath, "utf8")).resolves.toBe(
      JSON.stringify(userSettings, null, 2)
    );
  });

  it("unconfigures legacy Gemini-managed settings from older poe-code versions", async () => {
    await mockFsObj.mkdir(path.dirname(settingsPath), { recursive: true });
    await mockFsObj.writeFile(
      settingsPath,
      JSON.stringify(
        {
          theme: "dark",
          selectedAuthType: "gemini-api-key",
          model: "gemini-2.5-pro",
          mcpServers: {}
        },
        null,
        2
      )
    );

    await expect(unconfigureGemini()).resolves.toBe(true);
    await expect(mockFsObj.readFile(settingsPath, "utf8")).resolves.toContain('"theme": "dark"');
    expect(JSON.parse(await mockFsObj.readFile(settingsPath, "utf8"))).toEqual({ theme: "dark" });
  });

  it("removes the generated settings document when no user keys remain", async () => {
    await configureGemini();

    await expect(unconfigureGemini()).resolves.toBe(true);
    await expect(mockFsObj.readFile(settingsPath, "utf8")).rejects.toThrow(/ENOENT/);
    await expect(unconfigureGemini()).resolves.toBe(false);
  });
});

describe("goose service", () => {
  let mockFsObj: FileSystem;
  const home = "/home/user";
  const configPath = path.join(home, ".config", "goose", "config.yaml");
  const providerPath = path.join(home, ".config", "goose", "custom_providers", "custom_poe.json");
  const secretsPath = path.join(home, ".config", "goose", "secrets.yaml");
  let env = createCliEnvironment({
    cwd: home,
    homeDir: home
  });

  beforeEach(() => {
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
      scope: "test:goose"
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
    } satisfies ProviderContext;

    return { context, logs };
  }

  type ConfigureOptions = Parameters<typeof gooseService.gooseService.configure>[0]["options"];

  const buildConfigureOptions = (overrides: Partial<ConfigureOptions> = {}): ConfigureOptions => ({
    env,
    provider: {
      id: PROVIDER_NAME,
      apiShape: "openai-chat-completions",
      baseUrl: "https://api.poe.com/v1",
      credential: "sk-goose",
      extraEnv: {}
    },
    model: DEFAULT_GOOSE_MODEL,
    modelContextLimits: buildGooseModelContextLimitsFixture(),
    ...overrides
  });

  async function configureGoose(overrides: Partial<ConfigureOptions> = {}): Promise<void> {
    await gooseService.gooseService.configure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: buildConfigureOptions(overrides)
    });
  }

  it("creates the goose config, custom provider, and persisted secrets files", async () => {
    await configureGoose();

    const config = parseYaml(await mockFsObj.readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(config.GOOSE_PROVIDER).toBe("custom_poe");
    expect(config.GOOSE_MODEL).toBe(DEFAULT_GOOSE_MODEL);
    expect(config.GOOSE_DISABLE_KEYRING).toBe(true);

    const provider = JSON.parse(await mockFsObj.readFile(providerPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(provider.name).toBe("custom_poe");
    expect(provider.base_url).toBe("https://api.poe.com/v1/chat/completions");
    expect(provider.api_key_env).toBe("CUSTOM_POE_API_KEY");
    expect(provider.headers).toBeUndefined();
    expect(provider.models).toEqual(buildCustomProviderModelsFixture());

    const secrets = parseYaml(await mockFsObj.readFile(secretsPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(secrets).toEqual({
      CUSTOM_POE_API_KEY: "sk-goose"
    });
  });

  it("merges existing goose config and preserves unrelated settings", async () => {
    await mockFsObj.mkdir(path.dirname(configPath), { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      ["theme: dark", "extensions:", "  custom:", "    enabled: true"].join("\n"),
      { encoding: "utf8" }
    );

    await configureGoose({ model: FRONTIER_MODELS[FRONTIER_MODELS.length - 1]! });

    const config = parseYaml(await mockFsObj.readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(config.theme).toBe("dark");
    expect(config.GOOSE_MODEL).toBe(FRONTIER_MODELS[FRONTIER_MODELS.length - 1]!);
    expect(
      ((config.extensions as Record<string, unknown>).custom as Record<string, unknown>).enabled
    ).toBe(true);
  });

  it("uses provider.baseUrl when building the custom provider config", async () => {
    await configureGoose({
      provider: {
        id: PROVIDER_NAME,
        apiShape: "openai-chat-completions",
        baseUrl: "https://proxy.example.test/gateway/v1",
        credential: "sk-goose",
        extraEnv: {}
      }
    });

    const provider = JSON.parse(await mockFsObj.readFile(providerPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(provider.base_url).toBe("https://proxy.example.test/gateway/v1/chat/completions");
  });

  it("uses the static fallback context limit when modelContextLimits is empty", async () => {
    await configureGoose({ model: "anthropic/claude-sonnet-4.6", modelContextLimits: {} });

    const provider = JSON.parse(await mockFsObj.readFile(providerPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(provider.models).toEqual([
      { name: "anthropic/claude-sonnet-4.6", context_limit: 983_040 }
    ]);
  });

  it("writes only the selected model into the custom provider models list", async () => {
    await configureGoose({
      model: "anthropic/claude-haiku-4.5",
      modelContextLimits: { "anthropic/claude-haiku-4.5": 200_000 }
    });

    const provider = JSON.parse(await mockFsObj.readFile(providerPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(provider.models).toEqual([{ name: "anthropic/claude-haiku-4.5", context_limit: 200_000 }]);
  });

  it("omits context_limit when the selected model has no known context window", async () => {
    await configureGoose({ model: "novita ai/kimi-k2-thinking", modelContextLimits: {} });

    const provider = JSON.parse(await mockFsObj.readFile(providerPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(provider.models).toEqual([{ name: "novita ai/kimi-k2-thinking" }]);
  });

  it("fetches the Goose model context limit for the selected model", async () => {
    const modelContextLimits = await gooseService.gooseService.extendConfigurePayload?.({
      fs: mockFsObj,
      env,
      httpClient: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "claude-opus-4.7",
              context_window: { context_length: 983040 }
            },
            {
              id: "claude-sonnet-4.6",
              context_window: { context_length: 983040 }
            },
            {
              id: "gpt-5.3-codex",
              context_window: { context_length: 400000 }
            },
            {
              id: "gpt-5.4-pro",
              context_window: { context_length: 1050000 }
            },
            {
              id: "gemini-3.1-pro",
              context_window: { context_length: 1048576 }
            }
          ]
        })
      })),
      logger: createLoggerFactory(() => {}).create({
        dryRun: false,
        verbose: true,
        scope: "test:goose"
      }),
      payload: buildConfigureOptions({ model: "anthropic/claude-sonnet-4.6" })
    });

    expect(modelContextLimits).toEqual({
      modelContextLimits: { "anthropic/claude-sonnet-4.6": 983040 }
    });
  });

  it("falls back to the static context limit when the API response omits the selected model", async () => {
    const result = await gooseService.gooseService.extendConfigurePayload?.({
      fs: mockFsObj,
      env,
      httpClient: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "claude-opus-4.7",
              context_window: { context_length: 983040 }
            }
          ]
        })
      })),
      logger: createLoggerFactory(() => {}).create({
        dryRun: false,
        verbose: true,
        scope: "test:goose"
      }),
      payload: buildConfigureOptions({ model: "anthropic/claude-sonnet-4.6" })
    });

    expect(result).toEqual({
      modelContextLimits: {
        "anthropic/claude-sonnet-4.6": 983_040
      }
    });
  });

  it("reports no context limit when neither the catalog nor the fallbacks know the model", async () => {
    const result = await gooseService.gooseService.extendConfigurePayload?.({
      fs: mockFsObj,
      env,
      httpClient: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "kimi-k2-thinking", context_window: null }] })
      })),
      logger: createLoggerFactory(() => {}).create({
        dryRun: false,
        verbose: true,
        scope: "test:goose"
      }),
      payload: buildConfigureOptions({ model: "novita ai/kimi-k2-thinking" })
    });

    expect(result).toEqual({ modelContextLimits: {} });
  });

  it("removes managed Goose provider artifacts during unconfigure", async () => {
    await configureGoose();

    const changed = await gooseService.gooseService.unconfigure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: {}
    });

    expect(changed).toBe(true);
    await expect(mockFsObj.readFile(configPath, "utf8")).rejects.toThrow();
    await expect(mockFsObj.readFile(providerPath, "utf8")).rejects.toThrow();
    await expect(mockFsObj.readFile(secretsPath, "utf8")).rejects.toThrow();
  });

  it("restores overwritten Goose settings after unconfigure", async () => {
    const originalConfig = [
      "GOOSE_PROVIDER: user_provider",
      "GOOSE_MODEL: user_model",
      "theme: dark"
    ].join("\n");
    const originalProvider = '{"name":"user provider"}\n';
    const originalSecrets = ["CUSTOM_POE_API_KEY: user-key", "USER_SECRET: keep"].join("\n");
    await mockFsObj.mkdir(path.dirname(configPath), { recursive: true });
    await mockFsObj.mkdir(path.dirname(providerPath), { recursive: true });
    await mockFsObj.writeFile(configPath, originalConfig, { encoding: "utf8" });
    await mockFsObj.writeFile(providerPath, originalProvider, { encoding: "utf8" });
    await mockFsObj.writeFile(secretsPath, originalSecrets, { encoding: "utf8" });

    await configureGoose();
    await expect(
      gooseService.gooseService.unconfigure({
        fs: mockFsObj,
        env,
        command: createTestCommandContext(mockFsObj),
        options: {}
      })
    ).resolves.toBe(true);

    await expect(mockFsObj.readFile(configPath, "utf8")).resolves.toBe(originalConfig);
    await expect(mockFsObj.readFile(providerPath, "utf8")).resolves.toBe(originalProvider);
    await expect(mockFsObj.readFile(secretsPath, "utf8")).resolves.toBe(originalSecrets);
  });

  it("only prunes Goose YAML settings when the active provider is Poe-managed", async () => {
    await mockFsObj.mkdir(path.dirname(configPath), { recursive: true });
    await mockFsObj.mkdir(path.dirname(providerPath), { recursive: true });
    await mockFsObj.writeFile(
      configPath,
      [
        "GOOSE_PROVIDER: openai",
        "GOOSE_MODEL: openai/gpt-5.4",
        "GOOSE_DISABLE_KEYRING: true",
        "theme: dark"
      ].join("\n"),
      { encoding: "utf8" }
    );
    await mockFsObj.writeFile(
      providerPath,
      `${JSON.stringify(buildCustomProviderFixture(), null, 2)}\n`,
      { encoding: "utf8" }
    );
    await mockFsObj.writeFile(
      secretsPath,
      ["CUSTOM_POE_API_KEY: sk-goose", "OPENAI_API_KEY: openai-key"].join("\n"),
      { encoding: "utf8" }
    );

    const changed = await gooseService.gooseService.unconfigure({
      fs: mockFsObj,
      env,
      command: createTestCommandContext(mockFsObj),
      options: {}
    });

    expect(changed).toBe(true);
    const config = parseYaml(await mockFsObj.readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(config.GOOSE_PROVIDER).toBe("openai");
    expect(config.GOOSE_MODEL).toBe("openai/gpt-5.4");
    expect(config.theme).toBe("dark");
    await expect(mockFsObj.readFile(providerPath, "utf8")).rejects.toThrow();
    const secrets = parseYaml(await mockFsObj.readFile(secretsPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(secrets).toEqual({
      OPENAI_API_KEY: "openai-key"
    });
  });

  it("spawns Goose with provider and model flags", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "goose-output\n",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = createProviderTestContext(runCommand).context;

    const result = await gooseService.gooseService.spawn?.(providerContext, {
      prompt: "List files",
      model: DEFAULT_GOOSE_MODEL,
      args: ["--session", "resume-1"]
    });

    expect(runCommand).toHaveBeenCalledWith(
      "goose",
      [
        "run",
        "--provider",
        "custom_poe",
        "--model",
        DEFAULT_GOOSE_MODEL,
        "--output-format",
        "text",
        "--text",
        "List files",
        "--session",
        "resume-1"
      ],
      { env: { GOOSE_DISABLE_KEYRING: "1" } }
    );
    expect(result).toEqual({
      stdout: "goose-output\n",
      stderr: "",
      exitCode: 0
    });
  });

  it("uses stdin mode for Goose when requested", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "goose-output\n",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = createProviderTestContext(runCommand).context;

    await gooseService.gooseService.spawn?.(providerContext, {
      prompt: "Read from stdin",
      useStdin: true
    });

    expect(runCommand).toHaveBeenCalledWith(
      "goose",
      ["run", "--provider", "custom_poe", "--output-format", "text", "--instructions", "-"],
      {
        env: { GOOSE_DISABLE_KEYRING: "1" },
        stdin: "Read from stdin"
      }
    );
  });

  it("spawns Goose with MCP server args", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "goose-output\n",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = createProviderTestContext(runCommand).context;

    await gooseService.gooseService.spawn?.(providerContext, {
      prompt: "Call the tool",
      mcpServers: {
        "my-server": {
          command: "my-mcp-server",
          args: ["serve"]
        }
      }
    });

    expect(runCommand).toHaveBeenCalledWith(
      "goose",
      [
        "run",
        "--provider",
        "custom_poe",
        "--output-format",
        "text",
        "--with-extension",
        "my-mcp-server serve",
        "--text",
        "Call the tool"
      ],
      { env: { GOOSE_DISABLE_KEYRING: "1" } }
    );
  });

  it("spawns Goose in edit mode with GOOSE_MODE env var", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "goose-output\n",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = createProviderTestContext(runCommand).context;

    await gooseService.gooseService.spawn?.(providerContext, {
      prompt: "Edit the file",
      mode: "edit"
    });

    expect(runCommand).toHaveBeenCalledWith(
      "goose",
      ["run", "--provider", "custom_poe", "--output-format", "text", "--text", "Edit the file"],
      { env: { GOOSE_DISABLE_KEYRING: "1", GOOSE_MODE: "smart_approve" } }
    );
  });

  it("spawns Goose in read mode with GOOSE_MODE env var", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "goose-output\n",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = createProviderTestContext(runCommand).context;

    await gooseService.gooseService.spawn?.(providerContext, {
      prompt: "Explain the code",
      mode: "read"
    });

    expect(runCommand).toHaveBeenCalledWith(
      "goose",
      ["run", "--provider", "custom_poe", "--output-format", "text", "--text", "Explain the code"],
      { env: { GOOSE_DISABLE_KEYRING: "1", GOOSE_MODE: "chat" } }
    );
  });

  it("runs the Goose health check via goose run", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "GOOSE_OK\n",
      stderr: "",
      exitCode: 0
    });
    const { context } = createProviderTestContext(runCommand);

    await gooseService.gooseService.test?.(context);

    expect(runCommand).toHaveBeenCalledWith(
      "goose",
      ["run", "--text", "Reply with exactly: GOOSE_OK", "--output-format", "text"],
      { env: { GOOSE_DISABLE_KEYRING: "1" } }
    );
  });
});

function buildCustomProviderFixture(): Record<string, unknown> {
  return {
    name: "custom_poe",
    engine: "openai",
    display_name: "Poe",
    description: "Poe OpenAI-compatible API",
    api_key_env: "CUSTOM_POE_API_KEY",
    base_url: "https://api.poe.com/v1/chat/completions",
    models: buildCustomProviderModelsFixture(),
    supports_streaming: true,
    requires_auth: true
  };
}

function buildCustomProviderModelsFixture(
  model: string = DEFAULT_GOOSE_MODEL
): Array<Record<string, unknown>> {
  return [{ name: model, context_limit: buildGooseModelContextLimitsFixture()[model] }];
}

function buildGooseModelContextLimitsFixture(): Record<string, number> {
  return {
    "anthropic/claude-opus-4.7": 983040,
    "anthropic/claude-sonnet-4.6": 983040,
    "openai/gpt-5.3-codex": 400000,
    "openai/gpt-5.4-pro": 1050000,
    "google/gemini-3.1-pro": 1048576
  };
}

describe("poe-agent provider", () => {
  beforeEach(() => {
    createAgentSessionMock.mockReset();
    sendMessageMock.mockReset();
    disposeMock.mockReset();
    getHistoryMock.mockReset();
    createAgentSessionStoreMock.mockReset();
    createAgentSessionStoreMock.mockImplementation(
      (options: { homeDir?: string; fs: MockFileSystem }) => {
        const sessionsDir = path.join(options.homeDir ?? homeDir, ".poe-code", "sessions");
        return {
          async load(threadId: string) {
            try {
              const value = await options.fs.readFile(
                path.join(sessionsDir, `${threadId}.json`),
                "utf8"
              );
              return JSON.parse(String(value));
            } catch (error) {
              if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                return undefined;
              }
              throw error;
            }
          },
          async save(session: { threadId: string }) {
            await options.fs.mkdir(sessionsDir, { recursive: true });
            await options.fs.writeFile(
              path.join(sessionsDir, `${session.threadId}.json`),
              `${JSON.stringify(session)}\n`,
              { encoding: "utf8" }
            );
          }
        };
      }
    );

    sendMessageMock.mockImplementation(
      async (_prompt: string, options?: { onSessionUpdate?: (update: unknown) => void }) => {
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
    getHistoryMock.mockReturnValue([
      { role: "user", content: "Summarize this diff" },
      { role: "assistant", content: "Poe agent output" }
    ]);
    disposeMock.mockResolvedValue(undefined);
    createAgentSessionMock.mockResolvedValue({
      sendMessage: sendMessageMock,
      getHistory: getHistoryMock,
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
    const fs = createMockFs(undefined, homeDir);

    const { events, done } = spawnPoeAgentWithAcp({
      prompt: "Summarize this diff",
      model: "anthropic/claude-opus-4.7",
      cwd: "/workspace/project",
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      },
      homeDir,
      configPath: `${homeDir}/.poe-code/config.json`,
      projectConfigPath: "/workspace/project/.poe-code/config.json",
      fs
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
      model: "anthropic/claude-opus-4.7",
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
    expect(promptSpy).toHaveBeenCalledWith(expect.any(String), [
      { type: "text", text: "Summarize this diff" }
    ]);
    expect(initializeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      newSessionSpy.mock.invocationCallOrder[0]
    );
    expect(newSessionSpy.mock.invocationCallOrder[0]).toBeLessThan(
      promptSpy.mock.invocationCallOrder[0]
    );
    expect(sendMessageMock).toHaveBeenCalledWith(
      "Summarize this diff",
      expect.objectContaining({
        onSessionUpdate: expect.any(Function)
      })
    );
    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(received).toEqual([
      { event: "session_start", threadId: expect.stringMatching(/^poe-agent-/) },
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
      threadId: expect.stringMatching(/^poe-agent-/)
    });

    initializeSpy.mockRestore();
    newSessionSpy.mockRestore();
    promptSpy.mockRestore();
  });

  it("uses default model when none is provided", async () => {
    const fs = createMockFs(undefined, homeDir);
    const { done } = spawnPoeAgentWithAcp({
      prompt: "Explain this function",
      homeDir,
      configPath: `${homeDir}/.poe-code/config.json`,
      projectConfigPath: `${process.cwd()}/.poe-code/config.json`,
      fs
    });
    await done;

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: DEFAULT_FRONTIER_MODEL,
      cwd: process.cwd()
    });
  });

  it("resumes a persisted session and reuses its thread id", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/sessions/poe-agent-existing.json": `${JSON.stringify({
          version: 1,
          threadId: "poe-agent-existing",
          model: "openai/gpt-5.4-pro",
          cwd: "/workspace/original",
          createdAt: "2026-06-12T12:00:00.000Z",
          updatedAt: "2026-06-12T12:00:00.000Z",
          messages: [{ role: "assistant", content: "remembered" }]
        })}\n`
      },
      homeDir
    );

    const { done } = spawnPoeAgentWithAcp({
      prompt: "continue",
      resumeThreadId: "poe-agent-existing",
      cwd: "/workspace/current",
      homeDir,
      configPath: `${homeDir}/.poe-code/config.json`,
      projectConfigPath: "/workspace/current/.poe-code/config.json",
      fs
    });

    await expect(done).resolves.toEqual(
      expect.objectContaining({
        exitCode: 0,
        threadId: "poe-agent-existing"
      })
    );
    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-5.4-pro",
        resume: { messages: [{ role: "assistant", content: "remembered" }] }
      })
    );
  });

  it("rejects an unknown resume thread", async () => {
    const { done } = spawnPoeAgentWithAcp({
      prompt: "continue",
      resumeThreadId: "nope",
      homeDir,
      fs: createMockFs(undefined, homeDir)
    });

    await expect(done).rejects.toThrow(
      'Unknown poe-agent thread "nope". Sessions are stored in ~/.poe-code/sessions.'
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it("loads agent.plugins from poe-code-config and forwards pluginsConfig", async () => {
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": `${JSON.stringify(
          {
            agent: {
              plugins: [
                { name: "system-prompt" },
                { name: "memory" },
                { name: "policy", options: { mode: "read" } }
              ]
            }
          },
          null,
          2
        )}\n`
      },
      homeDir
    );

    const { done } = spawnPoeAgentWithAcp({
      prompt: "Explain this function",
      cwd: "/workspace/project",
      homeDir,
      configPath: `${homeDir}/.poe-code/config.json`,
      projectConfigPath: "/workspace/project/.poe-code/config.json",
      fs
    });
    await done;

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: DEFAULT_FRONTIER_MODEL,
      cwd: "/workspace/project",
      pluginsConfig: [
        { name: "system-prompt" },
        { name: "memory" },
        { name: "policy", options: { mode: "read" } }
      ]
    });
  });

  it("forwards baseUrl override to createAgentSession", async () => {
    const fs = createMockFs(undefined, homeDir);
    const { done } = spawnPoeAgentWithAcp({
      prompt: "Explain this function",
      baseUrl: "http://proxy.example.com/v1",
      homeDir,
      configPath: `${homeDir}/.poe-code/config.json`,
      projectConfigPath: `${process.cwd()}/.poe-code/config.json`,
      fs
    });
    await done;

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      model: DEFAULT_FRONTIER_MODEL,
      cwd: process.cwd(),
      baseUrl: "http://proxy.example.com/v1"
    });
  });

  it("preserves prototype-named MCP servers for poe-agent sessions", async () => {
    const { done } = spawnPoeAgentWithAcp({
      prompt: "Explain this function",
      mcpServers: JSON.parse('{"__proto__":{"command":"custom-server"}}'),
      homeDir,
      configPath: `${homeDir}/.poe-code/config.json`,
      projectConfigPath: `${process.cwd()}/.poe-code/config.json`,
      fs: createMockFs(undefined, homeDir)
    });
    await done;

    const options = createAgentSessionMock.mock.calls[0]?.[0] as {
      mcpServers?: Record<string, unknown>;
    };
    expect(Object.hasOwn(options.mcpServers ?? {}, "__proto__")).toBe(true);
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

  it("refuses to append provider output through a symbolic link", async () => {
    const volume = Volume.fromJSON({ "/outside-output": "sentinel" }, "/");
    volume.mkdirSync("/github", { recursive: true });
    volume.symlinkSync("/outside-output", "/github/output");
    const memoryFs = createFsFromVolume(volume);
    const { emitOutputs } = await import(scriptPath);

    expect(() => emitOutputs({ service: "codex" }, "/github/output", memoryFs)).toThrow(
      "symbolic link"
    );
    expect(memoryFs.readFileSync("/outside-output", "utf8")).toBe("sentinel");
  });
});

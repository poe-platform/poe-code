import { describe, it, expect, beforeEach, vi } from "bun:test";
import path from "node:path";
import type { FileSystem } from "../utils/file-system.js";
import * as claudeService from "./claude-code.js";
import type { ProviderContext } from "../cli/service-registry.js";
import { createCliEnvironment } from "../cli/environment.js";
import { createTestCommandContext } from "../../tests/test-command-context.js";
import {
  CLAUDE_CODE_VARIANTS,
  stripModelNamespace
} from "../cli/constants.js";
import { createLoggerFactory } from "../cli/logger.js";
import { createMockFs } from "@poe-code/config-mutations/testing";

const resolveVariantModel = (
  variant: keyof typeof CLAUDE_CODE_VARIANTS
): string => CLAUDE_CODE_VARIANTS[variant];

const CLAUDE_MODEL_HAIKU = resolveVariantModel("haiku");
const CLAUDE_MODEL_SONNET = resolveVariantModel("sonnet");
const CLAUDE_MODEL_OPUS = resolveVariantModel("opus");

describe("claude-code service", () => {
  let fs: FileSystem;
  const home = "/home/user";
  const settingsPath = path.join(home, ".claude", "settings.json");
  let env = createCliEnvironment({
    cwd: home,
    homeDir: home
  });

  beforeEach(async () => {
    fs = createMockFs({}, home);
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
        fs
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
      fs,
      env,
      command: createTestCommandContext(fs),
      options: buildConfigureOptions(overrides)
    });
  }

  async function unconfigureClaude(
    overrides: Partial<UnconfigureOptions> = {}
  ): Promise<boolean> {
    return claudeService.claudeCodeService.unconfigure({
      fs,
      env,
      command: createTestCommandContext(fs),
      options: buildUnconfigureOptions(overrides)
    });
  }

  it("removeClaudeCode prunes manifest-managed env keys from settings json", async () => {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
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

    const content = await fs.readFile(settingsPath, "utf8");
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
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
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

    await expect(fs.readFile(settingsPath, "utf8")).rejects.toThrow();
  });

  it("removeClaudeCode returns false when settings file absent", async () => {
    const removed = await unconfigureClaude();
    expect(removed).toBe(false);
  });

  it("creates settings json with claude env configuration", async () => {
    await configureClaude();

    const content = await fs.readFile(settingsPath, "utf8");
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

    const content = await fs.readFile(settingsPath, "utf8");
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
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
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

    const content = await fs.readFile(settingsPath, "utf8");
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

    // Test the binary check directly (used during installation)
    const binaryCheck = claudeService.CLAUDE_CODE_INSTALL_DEFINITION.check;
    await binaryCheck.run({ isDryRun: false, runCommand });

    expect(captured.map((entry) => entry.command)).toEqual(["which", "where"]);
    expect(captured[1]).toEqual({ command: "where", args: ["claude"] });
  });

  it("creates ~/.claude directory when configuring", async () => {
    await configureClaude();
    await fs.stat(path.join(home, ".claude"));
  });

  it("does not create history.jsonl when configuring", async () => {
    await configureClaude();
    await expect(fs.stat(path.join(home, ".claude", "history.jsonl"))).rejects.toThrow();
  });
});

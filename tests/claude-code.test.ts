import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import type { FileSystem } from "../src/utils/file-system.js";
import * as claudeService from "../src/providers/claude-code.js";
import type { ProviderContext } from "../src/cli/service-registry.js";
import { createCliEnvironment } from "../src/cli/environment.js";
import { createTestCommandContext } from "./test-command-context.js";
import {
  CLAUDE_CODE_VARIANTS,
  DEFAULT_CLAUDE_CODE_MODEL
} from "../src/cli/constants.js";
import { createLoggerFactory } from "../src/cli/logger.js";

const resolveVariantModel = (
  variant: keyof typeof CLAUDE_CODE_VARIANTS
): string => CLAUDE_CODE_VARIANTS[variant];

const CLAUDE_MODEL_HAIKU = resolveVariantModel("haiku");
const CLAUDE_MODEL_SONNET = resolveVariantModel("sonnet");
const CLAUDE_MODEL_OPUS = resolveVariantModel("opus");

function createMemFs(): { fs: FileSystem; vol: Volume } {
  const vol = new Volume();
  const fs = createFsFromVolume(vol);
  return { fs: fs.promises as unknown as FileSystem, vol };
}

describe("claude-code service", () => {
  let fs: FileSystem;
  let vol: Volume;
  const home = "/home/user";
  const settingsPath = path.join(home, ".claude", "settings.json");
  const keyHelperPath = path.join(home, ".claude", "anthropic_key.sh");
  let env = createCliEnvironment({
    cwd: home,
    homeDir: home
  });

  beforeEach(async () => {
    ({ fs, vol } = createMemFs());
    vol.mkdirSync(home, { recursive: true });
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
      keyHelperPath,
      "#!/bin/bash\necho existing\n",
      { encoding: "utf8" }
    );
    await fs.writeFile(
      settingsPath,
      JSON.stringify(
        {
          apiKeyHelper: "./anthropic_key.sh",
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
    await expect(fs.readFile(keyHelperPath, "utf8")).rejects.toThrow();
  });

  it("removeClaudeCode deletes settings file when only manifest keys remain", async () => {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      keyHelperPath,
      "#!/bin/bash\necho existing\n",
      { encoding: "utf8" }
    );
    await fs.writeFile(
      settingsPath,
      JSON.stringify(
        {
          apiKeyHelper: "./anthropic_key.sh",
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
    await expect(fs.readFile(keyHelperPath, "utf8")).rejects.toThrow();
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
      env: {
        ANTHROPIC_BASE_URL: "https://api.poe.com"
      },
      model: CLAUDE_MODEL_SONNET
    });
    await expect(fs.readFile(keyHelperPath, "utf8")).rejects.toThrow();
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
      theme: "dark",
      env: {
        ANTHROPIC_BASE_URL: "https://api.poe.com",
        CUSTOM: "value"
      },
      model: CLAUDE_MODEL_SONNET
    });
  });

  it("spawns the claude CLI with the provided prompt and args", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = createProviderTestContext(runCommand).context;

    const result = await claudeService.claudeCodeService.spawn(
      providerContext,
      {
        prompt: "Test prompt",
        args: ["--custom-arg", "value"]
      }
    );

    expect(runCommand).toHaveBeenCalledWith("poe-code", [
      "wrap",
      "claude-code",
      "-p",
      "Test prompt",
      "--allowedTools",
      "Bash,Read",
      "--permission-mode",
      "acceptEdits",
      "--output-format",
      "text",
      "--custom-arg",
      "value"
    ]);
    expect(result).toEqual({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0
    });
  });

  it("spawns the claude CLI with a custom model", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0
    }));
    const providerContext = createProviderTestContext(runCommand).context;

    await claudeService.claudeCodeService.spawn(providerContext, {
      prompt: "Test prompt",
      model: CLAUDE_MODEL_HAIKU
    });

    expect(runCommand).toHaveBeenCalledWith("poe-code", [
      "wrap",
      "claude-code",
      "-p",
      "Test prompt",
      "--model",
      CLAUDE_MODEL_HAIKU,
      "--allowedTools",
      "Bash,Read",
      "--permission-mode",
      "acceptEdits",
      "--output-format",
      "text"
    ]);
  });

  it("spawns the claude CLI with stdin when requested", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0
    }));
    const { context: providerContext } = createProviderTestContext(runCommand);

    await claudeService.claudeCodeService.spawn(providerContext, {
      prompt: "Test prompt",
      useStdin: true
    });

    expect(runCommand).toHaveBeenCalledWith(
      "poe-code",
      [
        "wrap",
        "claude-code",
        "-p",
        "--input-format",
        "text",
        "--allowedTools",
        "Bash,Read",
        "--permission-mode",
        "acceptEdits",
        "--output-format",
        "text"
      ],
      { stdin: "Test prompt" }
    );
  });

  it("runs the Claude CLI health check when invoking the provider test", async () => {
    await fs.mkdir(path.join(home, ".poe-code"), { recursive: true });
    await fs.writeFile(
      path.join(home, ".poe-code", "credentials.json"),
      JSON.stringify({ apiKey: "sk-test" }),
      { encoding: "utf8" }
    );
    const runCommand = vi.fn(async (command: string) => ({
      stdout: command === "/bin/sh" ? "sk-test\n" : "CLAUDE_CODE_OK\n",
      stderr: "",
      exitCode: 0
    }));
    const { context } = createProviderTestContext(runCommand);

    await claudeService.claudeCodeService.test?.(context);

    expect(runCommand).toHaveBeenCalledWith("claude", [
      "-p",
      "Output exactly: CLAUDE_CODE_OK",
      "--model",
      DEFAULT_CLAUDE_CODE_MODEL,
      "--allowedTools",
      "Bash,Read",
      "--permission-mode",
      "acceptEdits",
      "--output-format",
      "text"
    ]);
  });

  it("skips the Claude health check during dry runs", async () => {
    const runCommand = vi.fn();
    const { context, logs } = createProviderTestContext(runCommand, {
      dryRun: true
    });

    await claudeService.claudeCodeService.test?.(context);

    expect(runCommand).not.toHaveBeenCalled();
    expect(
      logs.find((line) =>
        line.includes(
          `claude -p "Output exactly: CLAUDE_CODE_OK" --model ${DEFAULT_CLAUDE_CODE_MODEL}`
        )
      )
    ).toBeTruthy();
  });

  it("includes stdout and stderr when the Claude health check command fails", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "FAIL_STDOUT\n",
      stderr: "FAIL_STDERR\n",
      exitCode: 1
    }));
    const { context } = createProviderTestContext(runCommand);

    await expect(
      claudeService.claudeCodeService.test?.(context)
    ).rejects.toThrow(/FAIL_STDOUT/);
  });

  it("includes stdout and stderr when the Claude health check output is unexpected", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "WRONG\n",
      stderr: "WARN\n",
      exitCode: 0
    }));
    const { context } = createProviderTestContext(runCommand);

    await expect(
      claudeService.claudeCodeService.test?.(context)
    ).rejects.toThrow(/expected "CLAUDE_CODE_OK" but received "WRONG"/i);
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

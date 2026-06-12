import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn as spawnChildProcess, type ChildProcess } from "node:child_process";
import { resolveConfig } from "./configs/resolve-config.js";
import { claudeCodeSpawnConfig } from "./configs/claude-code.js";
import { codexSpawnConfig } from "./configs/codex.js";
import { openCodeSpawnConfig } from "./configs/opencode.js";
import { kimiSpawnConfig } from "./configs/kimi.js";
import { gooseSpawnConfig } from "./configs/goose.js";
import { spawnInteractive } from "./spawn-interactive.js";
import { getMcpArgs } from "./mcp-args.js";
import type { CliSpawnConfig } from "./types.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

vi.mock("./configs/resolve-config.js", async () => {
  const actual = await vi.importActual<typeof import("./configs/resolve-config.js")>(
    "./configs/resolve-config.js"
  );
  return { ...actual, resolveConfig: vi.fn(actual.resolveConfig) };
});

function createMockInheritProcess(exitCode = 0): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess;
  (child as any).stdin = null;
  (child as any).stdout = null;
  (child as any).stderr = null;

  setImmediate(() => {
    child.emit("close", exitCode, null);
  });

  return child;
}

describe("spawnInteractive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws if agent ID cannot be resolved", async () => {
    await expect(spawnInteractive("unknown", { prompt: "test" })).rejects.toThrow(/Unknown agent/);
    expect(vi.mocked(spawnChildProcess)).not.toHaveBeenCalled();
  });

  it("throws if agent has no spawn config", async () => {
    await expect(spawnInteractive("claude-desktop", { prompt: "test" })).rejects.toThrow(
      /has no spawn config/
    );
    expect(vi.mocked(spawnChildProcess)).not.toHaveBeenCalled();
  });

  it("throws if agent has no interactive config", async () => {
    vi.mocked(resolveConfig).mockReturnValueOnce({
      agentId: "test-agent",
      binaryName: "test",
      spawnConfig: {
        kind: "cli",
        agentId: "test-agent",
        adapter: "native",
        promptFlag: "-p",
        modelStripProviderPrefix: true,
        defaultArgs: [],
        modes: { yolo: [], edit: [], read: [] }
      }
    });

    await expect(spawnInteractive("test-agent", { prompt: "test" })).rejects.toThrow(
      /does not support interactive mode/
    );
    expect(vi.mocked(spawnChildProcess)).not.toHaveBeenCalled();
  });

  it("builds positional prompt args for claude-code", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    const result = await spawnInteractive("claude-code", { prompt: "test prompt" });

    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    const [command, args] = spawnMock.mock.calls[0];
    expect(command).toBe("claude");
    expect(args).toEqual([
      "test prompt",
      ...claudeCodeSpawnConfig.interactive!.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo
    ]);
  });

  it("builds positional prompt args for codex", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("codex", { prompt: "test prompt" });

    const [command, args] = spawnMock.mock.calls[0];
    expect(command).toBe("codex");
    expect(args).toEqual([
      "test prompt",
      ...codexSpawnConfig.interactive!.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
  });

  it("builds flag-based prompt args for opencode", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("opencode", { prompt: "test prompt" });

    const [command, args] = spawnMock.mock.calls[0];
    expect(command).toBe("opencode");
    expect(args).toEqual([
      openCodeSpawnConfig.interactive!.promptFlag,
      "test prompt",
      ...openCodeSpawnConfig.interactive!.defaultArgs,
      ...openCodeSpawnConfig.modes.yolo
    ]);
  });

  it("builds flag-based prompt args for kimi", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("kimi", { prompt: "test prompt" });

    const [command, args] = spawnMock.mock.calls[0];
    expect(command).toBe("kimi");
    expect(args).toEqual([
      kimiSpawnConfig.interactive!.promptFlag,
      "test prompt",
      ...kimiSpawnConfig.interactive!.defaultArgs,
      ...kimiSpawnConfig.modes.yolo
    ]);
  });

  it("builds goose interactive args with the session subcommand before the prompt", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("goose", { prompt: "test prompt" });

    const [command, args] = spawnMock.mock.calls[0];
    expect(command).toBe("goose");
    expect(args).toEqual([...gooseSpawnConfig.interactive!.defaultArgs, "test prompt"]);
    const [, , spawnOpts] = spawnMock.mock.calls[0];
    expect(spawnOpts).toHaveProperty("env");
    expect(spawnOpts.env).toMatchObject({
      GOOSE_DISABLE_KEYRING: "1",
      GOOSE_MODE: "auto"
    });
  });

  it("includes model flag when model is provided", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("claude-code", { prompt: "test", model: "sonnet" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      "test",
      claudeCodeSpawnConfig.modelFlag,
      "sonnet",
      ...claudeCodeSpawnConfig.interactive!.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo
    ]);
  });

  it("applies modelTransform from config (preserves namespace + poe/ prefix)", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("opencode", { prompt: "test", model: "anthropic/claude-opus-4.6" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("poe/anthropic/claude-opus-4.6");
  });

  it("strips provider namespace and transforms model before passing to CLI", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("claude-code", { prompt: "test", model: "anthropic/claude-opus-4.6" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("claude-opus-4-6");
    expect(args).not.toContain("anthropic/claude-opus-4.6");
    expect(args).not.toContain("claude-opus-4.6");
  });

  it("spawns with stdio inherit for all streams", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("codex", { prompt: "test" });

    const [, , options] = spawnMock.mock.calls[0];
    expect(options).toEqual(expect.objectContaining({ stdio: "inherit" }));
  });

  it("returns empty stdout and stderr with exit code", async () => {
    vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(42));

    const result = await spawnInteractive("codex", { prompt: "test" });

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(42);
  });

  it("passes cwd to spawned process", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("codex", { prompt: "test", cwd: "/my/project" });

    const [, , options] = spawnMock.mock.calls[0];
    expect(options).toEqual(expect.objectContaining({ cwd: "/my/project" }));
  });

  it("omits prompt args when prompt is empty", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("claude-code", { prompt: "" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      ...claudeCodeSpawnConfig.interactive!.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo
    ]);
  });

  it("omits prompt flag when prompt is empty for flag-based agents", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("opencode", { prompt: "" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      ...openCodeSpawnConfig.interactive!.defaultArgs,
      ...openCodeSpawnConfig.modes.yolo
    ]);
    expect(args).not.toContain(openCodeSpawnConfig.interactive!.promptFlag);
  });

  it("appends extra args from options", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("codex", { prompt: "test", args: ["--extra", "flag"] });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      "test",
      ...codexSpawnConfig.interactive!.defaultArgs,
      ...codexSpawnConfig.modes.yolo,
      "--extra",
      "flag"
    ]);
  });

  it("serializes MCP servers for interactive spawn when supported", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("codex", {
      prompt: "test",
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"]
        }
      }
    });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      "test",
      ...codexSpawnConfig.interactive!.defaultArgs,
      "-c",
      'mcp_servers.test.command="tiny-stdio-mcp-test-server"',
      "-c",
      'mcp_servers.test.default_tools_approval_mode="approve"',
      "-c",
      'mcp_servers.test.args=["serve", "word-of-the-day"]',
      ...codexSpawnConfig.modes.yolo
    ]);
  });

  it("serializes opencode MCP servers into the interactive environment", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("opencode", {
      prompt: "test",
      mcpServers: {
        test: { command: "tiny-stdio-mcp-test-server", args: ["serve"] }
      }
    });

    const options = spawnMock.mock.calls[0]?.[2];
    expect(options?.env).toEqual(
      expect.objectContaining({
        OPENCODE_CONFIG_CONTENT: expect.stringContaining("tiny-stdio-mcp-test-server")
      })
    );
  });

  it("merges per-invocation environment overrides without mutating the parent", async () => {
    const inheritedValue = process.env.POE_CODE_INTERACTIVE_ENV_TEST;
    process.env.POE_CODE_INTERACTIVE_ENV_TEST = "parent";
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    try {
      await spawnInteractive("codex", {
        prompt: "test",
        env: { POE_CODE_INTERACTIVE_ENV_TEST: "child", INVOCATION_ONLY: "1" }
      });

      expect(spawnMock.mock.calls[0]?.[2]?.env).toMatchObject({
        POE_CODE_INTERACTIVE_ENV_TEST: "child",
        INVOCATION_ONLY: "1"
      });
      expect(process.env.POE_CODE_INTERACTIVE_ENV_TEST).toBe("parent");
    } finally {
      if (inheritedValue === undefined) delete process.env.POE_CODE_INTERACTIVE_ENV_TEST;
      else process.env.POE_CODE_INTERACTIVE_ENV_TEST = inheritedValue;
    }
  });

  it("removes inherited environment variables for one interactive spawn", async () => {
    const inheritedValue = process.env.POE_CODE_INTERACTIVE_UNSET_TEST;
    process.env.POE_CODE_INTERACTIVE_UNSET_TEST = "parent";
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(createMockInheritProcess(0));

    try {
      await spawnInteractive("codex", {
        prompt: "test",
        env: { POE_CODE_INTERACTIVE_UNSET_TEST: undefined }
      });

      expect(spawnMock.mock.calls[0]?.[2]?.env).not.toHaveProperty(
        "POE_CODE_INTERACTIVE_UNSET_TEST"
      );
      expect(process.env.POE_CODE_INTERACTIVE_UNSET_TEST).toBe("parent");
    } finally {
      if (inheritedValue === undefined) delete process.env.POE_CODE_INTERACTIVE_UNSET_TEST;
      else process.env.POE_CODE_INTERACTIVE_UNSET_TEST = inheritedValue;
    }
  });

  it("throws clear error for interactive MCP on unsupported agents", () => {
    const fakeConfig = { kind: "cli" as const, agentId: "fake-agent" } as CliSpawnConfig;
    expect(() =>
      getMcpArgs(fakeConfig, { test: { command: "tiny-stdio-mcp-test-server" } })
    ).toThrow('Agent "fake-agent" does not support MCP servers at spawn time.');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  spawn as spawnChildProcess,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import { claudeCodeSpawnConfig } from "./configs/claude-code.js";
import { codexSpawnConfig } from "./configs/codex.js";
import { openCodeSpawnConfig } from "./configs/opencode.js";
import { kimiSpawnConfig } from "./configs/kimi.js";
import { gooseSpawnConfig } from "./configs/goose.js";
import * as agentSpawnApi from "@poe-code/agent-spawn";
import { buildSpawnArgs } from "./spawn.js";
import { getMcpArgs } from "./mcp-args.js";
import { spawn } from "./spawn.js";
import { stripModelNamespace } from "./model-utils.js";
import type { CliSpawnConfig, OtelSink } from "./types.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

// === spawn.test.ts helpers ===

interface MockChildProcessOptions {
  stdout?: string;
  stdoutLines?: string[];
  stderr?: string;
  exitCode?: number;
  autoClose?: boolean;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

function stripMeta<T>(events: T[]): T[] {
  return events.map((event) => {
    if (event && typeof event === "object") {
      const { _meta: _ignored, ...rest } = event as Record<string, unknown>;
      void _ignored;
      return rest as T;
    }
    return event;
  });
}

function createMockChildProcess(
  options: MockChildProcessOptions = {}
): ChildProcessWithoutNullStreams {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  const childStreams = child as unknown as {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };
  childStreams.stdin = stdin;
  childStreams.stdout = stdout;
  childStreams.stderr = stderr;
  childStreams.kill = () => {
    child.emit("close", 1, "SIGTERM");
    return true;
  };

  let capturedStdin = "";
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk) => {
    capturedStdin += chunk;
  });
  (child as any).__capturedStdin = () => capturedStdin;

  const exitCode = options.exitCode ?? 0;
  const output = options.stdout ?? "";
  const outputLines = options.stdoutLines ?? [];
  const errorOutput = options.stderr ?? "";

  if (options.autoClose !== false) {
    setImmediate(() => {
      for (const line of outputLines) {
        stdout.write(`${line}\n`, "utf8");
      }
      if (output) {
        stdout.write(output, "utf8");
      }
      stdout.end();
      if (errorOutput) {
        stderr.write(errorOutput, "utf8");
      }
      stderr.end();
      child.emit("close", exitCode, null);
    });
  }

  return child;
}

// === index.test.ts ===

describe("@poe-code/agent-spawn", () => {
  it("exports a placeholder", () => {
    expect(agentSpawnApi.agentSpawn).toEqual({});
  });

  it("exports streaming + adapters API", () => {
    expect(typeof agentSpawnApi.spawn).toBe("function");
    expect(typeof agentSpawnApi.noopOtelSink.startSpan).toBe("function");
    expect(typeof agentSpawnApi.spawn.retry).toBe("function");
    expect(typeof agentSpawnApi.spawnAcp).toBe("function");
    expect(typeof agentSpawnApi.spawnInteractive).toBe("function");
    expect(typeof agentSpawnApi.spawnStreaming).toBe("function");
    expect(typeof agentSpawnApi.getAcpSpawnConfig).toBe("function");
    expect(typeof agentSpawnApi.readLines).toBe("function");
    expect(typeof agentSpawnApi.readSpawnLog).toBe("function");
    expect(typeof agentSpawnApi.listSpawnLogs).toBe("function");
    expect(typeof agentSpawnApi.findLatestLog).toBe("function");
    expect(typeof agentSpawnApi.pickRandomLog).toBe("function");
    expect(typeof agentSpawnApi.replaySpawnLog).toBe("function");
    expect(typeof agentSpawnApi.renderAcpStream).toBe("function");
    expect(typeof agentSpawnApi.adaptCodex).toBe("function");
    expect(typeof agentSpawnApi.adaptClaude).toBe("function");
    expect(typeof agentSpawnApi.adaptNative).toBe("function");
    expect(typeof agentSpawnApi.getAdapter).toBe("function");
    expect(typeof agentSpawnApi.supportsMcpAtSpawn).toBe("function");
    expect(typeof agentSpawnApi.listMcpSupportedAgents).toBe("function");
  });

  it("does not export internal helpers", () => {
    expect("truncate" in agentSpawnApi).toBe(false);
  });
});

// === model-utils.test.ts ===

describe("stripModelNamespace", () => {
  it("strips provider prefix from namespaced model", () => {
    expect(stripModelNamespace("anthropic/claude-opus-4.6")).toBe("claude-opus-4.6");
  });

  it("strips any provider prefix", () => {
    expect(stripModelNamespace("openai/gpt-5.2")).toBe("gpt-5.2");
    expect(stripModelNamespace("novitaai/kimi-k2.5")).toBe("kimi-k2.5");
  });

  it("returns bare model ID unchanged", () => {
    expect(stripModelNamespace("claude-opus-4.6")).toBe("claude-opus-4.6");
    expect(stripModelNamespace("o3")).toBe("o3");
  });

  it("handles model with multiple slashes by stripping only the first segment", () => {
    expect(stripModelNamespace("provider/model/variant")).toBe("model/variant");
  });
});

// === build-spawn-args.test.ts ===

describe("buildSpawnArgs", () => {
  it("throws error if agent ID cannot be resolved", () => {
    expect(() => buildSpawnArgs("unknown", { prompt: "test" })).toThrow(/Unknown agent/);
  });

  it("throws error if agent has no spawn config", () => {
    expect(() => buildSpawnArgs("claude-desktop", { prompt: "test" })).toThrow(
      /has no spawn config/
    );
  });

  it("builds args with promptFlag + prompt + defaultArgs + modes.yolo by default", () => {
    const result = buildSpawnArgs("claude-code", { prompt: "test" });

    expect(result.binaryName).toBe("claude");
    expect(result.args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "test",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo
    ]);
  });

  it("includes model flag when model is provided", () => {
    const result = buildSpawnArgs("codex", { prompt: "hello", model: "o3" });

    expect(result.binaryName).toBe("codex");
    expect(result.args).toEqual([
      codexSpawnConfig.promptFlag,
      "hello",
      codexSpawnConfig.modelFlag,
      "o3",
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
  });

  it("builds codex resume args from resumeThreadId", () => {
    const result = buildSpawnArgs("codex", {
      prompt: "continue",
      model: "o3",
      resumeThreadId: "thread_abc123"
    });

    expect(result.binaryName).toBe("codex");
    expect(result.args).toEqual([
      codexSpawnConfig.promptFlag,
      "resume",
      "thread_abc123",
      "continue",
      codexSpawnConfig.modelFlag,
      "o3",
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
  });

  it("builds claude-code resume args from resumeThreadId", () => {
    const result = buildSpawnArgs("claude-code", {
      prompt: "continue",
      resumeThreadId: "thread_abc123"
    });

    expect(result.args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "continue",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo,
      "--resume",
      "thread_abc123"
    ]);
  });

  it("strips provider namespace and converts dots to hyphens for claude-code model", () => {
    const result = buildSpawnArgs("claude-code", {
      prompt: "test",
      model: "anthropic/claude-opus-4.6"
    });

    expect(result.args).toContain("claude-opus-4-6");
    expect(result.args).not.toContain("anthropic/claude-opus-4.6");
    expect(result.args).not.toContain("claude-opus-4.6");
  });

  it("converts dots to hyphens for all claude-code models", () => {
    const result = buildSpawnArgs("claude-code", {
      prompt: "test",
      model: "anthropic/claude-sonnet-4.6"
    });

    expect(result.args).toContain("claude-sonnet-4-6");
    expect(result.args).not.toContain("claude-sonnet-4.6");
  });

  it("appends mode-specific args for edit mode", () => {
    const result = buildSpawnArgs("claude-code", { prompt: "test", mode: "edit" });

    expect(result.args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "test",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.edit
    ]);
  });

  it("appends mode-specific args for read mode", () => {
    const result = buildSpawnArgs("claude-code", { prompt: "test", mode: "read" });

    expect(result.args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "test",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.read
    ]);
  });

  it("appends extra args after mode args", () => {
    const result = buildSpawnArgs("claude-code", {
      prompt: "test",
      args: ["--extra", "arg"]
    });

    expect(result.args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "test",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo,
      "--extra",
      "arg"
    ]);
  });

  it("builds correct args for opencode", () => {
    const result = buildSpawnArgs("opencode", { prompt: "hello" });

    expect(result.binaryName).toBe("opencode");
    expect(result.args).toEqual([
      openCodeSpawnConfig.promptFlag,
      "hello",
      ...openCodeSpawnConfig.defaultArgs,
      ...openCodeSpawnConfig.modes.yolo
    ]);
  });

  it("applies modelTransform for opencode claude-opus-4.6 → poe/anthropic/claude-opus-4.6", () => {
    const result = buildSpawnArgs("opencode", {
      prompt: "hello",
      model: "anthropic/claude-opus-4.6"
    });

    expect(result.args).toContain("poe/anthropic/claude-opus-4.6");
  });

  it("preserves provider namespace for opencode models", () => {
    const result = buildSpawnArgs("opencode", {
      prompt: "hello",
      model: "anthropic/claude-sonnet-4.6"
    });

    expect(result.args).toContain("poe/anthropic/claude-sonnet-4.6");
  });

  it("preserves openai namespace for opencode models", () => {
    const result = buildSpawnArgs("opencode", {
      prompt: "hello",
      model: "openai/gpt-5.2"
    });

    expect(result.args).toContain("poe/openai/gpt-5.2");
  });

  it("adds poe/ prefix to bare opencode models", () => {
    const result = buildSpawnArgs("opencode", {
      prompt: "hello",
      model: "gpt-5.2"
    });

    expect(result.args).toContain("poe/gpt-5.2");
  });

  it("does not double poe/ prefix for opencode models", () => {
    const result = buildSpawnArgs("opencode", {
      prompt: "hello",
      model: "poe/gpt-5.2"
    });

    expect(result.args).toContain("poe/gpt-5.2");
    expect(result.args).not.toContain("poe/poe/gpt-5.2");
  });

  it("builds correct args for kimi", () => {
    const result = buildSpawnArgs("kimi", { prompt: "hello" });

    expect(result.binaryName).toBe("kimi");
    expect(result.args).toEqual([
      kimiSpawnConfig.promptFlag,
      "hello",
      ...kimiSpawnConfig.defaultArgs,
      ...kimiSpawnConfig.modes.yolo
    ]);
  });

  it("builds goose args with the run subcommand before prompt and model flags", () => {
    const result = buildSpawnArgs("goose", {
      prompt: "hello",
      model: "openai/gpt-5.4"
    });

    expect(result.binaryName).toBe("goose");
    expect(result.args).toEqual([
      ...gooseSpawnConfig.defaultArgs,
      gooseSpawnConfig.promptFlag,
      "hello",
      gooseSpawnConfig.modelFlag!,
      "openai/gpt-5.4"
    ]);
    expect(result.env).toEqual({
      GOOSE_DISABLE_KEYRING: "1",
      GOOSE_MODE: "auto"
    });
  });

  it("returns GOOSE_MODE env for goose edit mode", () => {
    const result = buildSpawnArgs("goose", { prompt: "hello", mode: "edit" });

    expect(result.env).toEqual({
      GOOSE_DISABLE_KEYRING: "1",
      GOOSE_MODE: "smart_approve"
    });
  });

  it("returns GOOSE_MODE env for goose read mode", () => {
    const result = buildSpawnArgs("goose", { prompt: "hello", mode: "read" });

    expect(result.env).toEqual({
      GOOSE_DISABLE_KEYRING: "1",
      GOOSE_MODE: "chat"
    });
  });

  it("builds stdin args for claude-code when useStdin is true", () => {
    const result = buildSpawnArgs("claude-code", { prompt: "test", useStdin: true });

    expect(result.args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      ...claudeCodeSpawnConfig.stdinMode!.extraArgs,
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo
    ]);
    expect(result.args).not.toContain("test");
  });

  it("builds stdin args with model for claude-code", () => {
    const result = buildSpawnArgs("claude-code", {
      prompt: "test",
      useStdin: true,
      model: "anthropic/claude-opus-4.6"
    });

    expect(result.args).toContain("--model");
    expect(result.args).toContain("claude-opus-4-6");
    expect(result.args).not.toContain("test");
  });

  it("builds stdin args for codex when useStdin is true", () => {
    const result = buildSpawnArgs("codex", { prompt: "test", useStdin: true });

    expect(result.args).toEqual([
      codexSpawnConfig.promptFlag,
      ...codexSpawnConfig.stdinMode!.extraArgs,
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
    expect(result.args).not.toContain("test");
  });

  it("uses stdin args for codex when the prompt contains a null byte", () => {
    const prompt = 'Test "a\0b" literal';
    const result = buildSpawnArgs("codex", { prompt });

    expect(result.args).toEqual([
      codexSpawnConfig.promptFlag,
      ...codexSpawnConfig.stdinMode!.extraArgs,
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
    expect(result.args).not.toContain(prompt);
  });

  it("ignores useStdin for agents without stdinMode", () => {
    const result = buildSpawnArgs("opencode", { prompt: "hello", useStdin: true });

    expect(result.args).toEqual([
      openCodeSpawnConfig.promptFlag,
      "hello",
      ...openCodeSpawnConfig.defaultArgs,
      ...openCodeSpawnConfig.modes.yolo
    ]);
  });

  it("adds claude-code MCP config as --mcp-config JSON before mode args", () => {
    const result = buildSpawnArgs("claude-code", {
      prompt: "hello",
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });

    const mcpIndex = result.args.indexOf("--mcp-config");
    expect(mcpIndex).toBeGreaterThan(-1);
    expect(JSON.parse(result.args[mcpIndex + 1] ?? "{}")).toEqual({
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });
    expect(result.args.slice(mcpIndex + 2)).toEqual([...claudeCodeSpawnConfig.modes.yolo]);
  });

  it("adds codex MCP config as repeated -c TOML overrides before the subcommand", () => {
    const result = buildSpawnArgs("codex", {
      prompt: "hello",
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });

    expect(result.args).toEqual([
      "-c",
      'mcp_servers.test.command="tiny-stdio-mcp-test-server"',
      "-c",
      'mcp_servers.test.args=["serve", "word-of-the-day"]',
      "-c",
      'mcp_servers.test.env={"MCP_LOG_LEVEL"="debug"}',
      codexSpawnConfig.promptFlag,
      "hello",
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
  });

  it("adds kimi MCP config as --mcp-config JSON before mode args", () => {
    const result = buildSpawnArgs("kimi", {
      prompt: "hello",
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"]
        }
      }
    });

    const mcpIndex = result.args.indexOf("--mcp-config");
    expect(mcpIndex).toBeGreaterThan(-1);
    expect(JSON.parse(result.args[mcpIndex + 1] ?? "{}")).toEqual({
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"]
        }
      }
    });
    expect(result.args.slice(mcpIndex + 2)).toEqual([...kimiSpawnConfig.modes.yolo]);
  });

  it("adds goose MCP config as --with-extension args before the prompt flag", () => {
    const result = buildSpawnArgs("goose", {
      prompt: "hello",
      mcpServers: {
        test: {
          command: "uvx",
          args: ["mcp-server-test", "--port", "3000"]
        }
      }
    });

    expect(result.args).toEqual([
      ...gooseSpawnConfig.defaultArgs,
      "--with-extension",
      "uvx mcp-server-test --port 3000",
      gooseSpawnConfig.promptFlag,
      "hello"
    ]);
    expect(result.env).toEqual({
      GOOSE_DISABLE_KEYRING: "1",
      GOOSE_MODE: "auto"
    });
  });

  it("throws a clear error when MCP config is passed to unsupported agents", () => {
    const fakeConfig = { kind: "cli" as const, agentId: "fake-agent" } as CliSpawnConfig;
    expect(() =>
      getMcpArgs(fakeConfig, {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"]
        }
      })
    ).toThrow('Agent "fake-agent" does not support MCP servers at spawn time.');
  });
});

// === spawn.test.ts ===

describe("spawn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws error if agent ID cannot be resolved", async () => {
    await expect(spawn("unknown", { prompt: "test" })).rejects.toThrow(/Unknown agent/);
    await expect(spawn("unknown", { prompt: "test" })).rejects.not.toThrow(/has no spawn config/);
    expect(vi.mocked(spawnChildProcess)).not.toHaveBeenCalled();
  });

  it("throws error if agent has no spawn config", async () => {
    await expect(spawn("claude-desktop", { prompt: "test" })).rejects.toThrow(
      /has no spawn config/
    );
    await expect(spawn("claude-desktop", { prompt: "test" })).rejects.not.toThrow(/Unknown agent/);
    expect(vi.mocked(spawnChildProcess)).not.toHaveBeenCalled();
  });

  it("spawns CLI using promptFlag + prompt + defaultArgs + options.args", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockChildProcess({ stdout: "ok\n", exitCode: 0 }));

    const result = await spawn("claude-code", {
      prompt: "test",
      args: ["--extra", "arg"]
    });

    expect(result).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args] = spawnMock.mock.calls[0];
    expect(command).toBe("claude");
    expect(args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "test",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo,
      "--extra",
      "arg"
    ]);
  });

  it("includes model flag when model is provided", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockChildProcess({ exitCode: 0 }));

    await spawn("codex", { prompt: "hello", model: "o3" });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args] = spawnMock.mock.calls[0];
    expect(command).toBe("codex");
    expect(args).toEqual([
      codexSpawnConfig.promptFlag,
      "hello",
      codexSpawnConfig.modelFlag,
      "o3",
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
  });

  it("passes resumeThreadId through provider resume args", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockChildProcess({ exitCode: 0 }));

    await spawn("claude-code", {
      prompt: "continue",
      resumeThreadId: "thread_abc123"
    });

    const [command, args] = spawnMock.mock.calls[0];
    expect(command).toBe("claude");
    expect(args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "continue",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo,
      "--resume",
      "thread_abc123"
    ]);
  });

  it("serializes codex MCP servers to -c TOML args", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockChildProcess({ exitCode: 0 }));

    await spawn("codex", {
      prompt: "hello",
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });

    const [command, args] = spawnMock.mock.calls[0];
    expect(command).toBe("codex");
    expect(args).toEqual([
      "-c",
      'mcp_servers.test.command="tiny-stdio-mcp-test-server"',
      "-c",
      'mcp_servers.test.args=["serve", "word-of-the-day"]',
      "-c",
      'mcp_servers.test.env={"MCP_LOG_LEVEL"="debug"}',
      codexSpawnConfig.promptFlag,
      "hello",
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
  });

  it("throws a clear error when MCP servers are passed to unsupported agents", () => {
    const fakeConfig = { kind: "cli" as const, agentId: "fake-agent" } as CliSpawnConfig;
    expect(() =>
      getMcpArgs(fakeConfig, { test: { command: "tiny-stdio-mcp-test-server" } })
    ).toThrow('Agent "fake-agent" does not support MCP servers at spawn time.');
  });

  // IMPORTANT: CLI binaries (claude, codex, etc.) only accept bare model IDs
  // (e.g. "claude-opus-4-6"), not namespaced ones (e.g. "anthropic/claude-opus-4.6").
  // The namespace MUST be stripped and dots converted to hyphens before invoking the binary.
  // Do NOT remove this stripping — it will break all spawns that pass a namespaced model.
  it("strips provider namespace and transforms model before passing to CLI", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockChildProcess({ exitCode: 0 }));

    await spawn("claude-code", { prompt: "test", model: "anthropic/claude-opus-4.6" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("claude-opus-4-6");
    expect(args).not.toContain("anthropic/claude-opus-4.6");
    expect(args).not.toContain("claude-opus-4.6");
  });

  it("passes cwd option to the spawned process", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockChildProcess({ exitCode: 0 }));

    await spawn("codex", { prompt: "hello", cwd: "/tmp/poe-agent-spawn" });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, , options] = spawnMock.mock.calls[0];
    expect(options).toEqual(expect.objectContaining({ cwd: "/tmp/poe-agent-spawn" }));
  });

  it("writes prompt to stdin when useStdin is enabled and supported", async () => {
    const cwd = "/repo";
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockChildProcess({ stdout: "ok\n", exitCode: 0 }));

    const result = await spawn("codex", { prompt: "hello", cwd, useStdin: true });

    expect(result).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, spawnOptions] = spawnMock.mock.calls[0]!;
    expect(command).toBe("codex");
    expect(args).toEqual([
      codexSpawnConfig.promptFlag,
      ...(codexSpawnConfig.stdinMode?.extraArgs ?? []),
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
    expect(spawnOptions).toMatchObject({
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const child = spawnMock.mock.results[0]?.value as any;
    expect(typeof child?.__capturedStdin).toBe("function");
    expect(child.__capturedStdin()).toBe("hello");
  });

  it("writes prompt to stdin for claude-code when supported", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockChildProcess({ stdout: "ok\n", exitCode: 0 }));

    await spawn("claude-code", { prompt: "hi", useStdin: true });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, spawnOptions] = spawnMock.mock.calls[0]!;
    expect(command).toBe("claude");
    expect(args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      ...(claudeCodeSpawnConfig.stdinMode?.extraArgs ?? []),
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo
    ]);
    expect(spawnOptions).toMatchObject({
      stdio: ["pipe", "pipe", "pipe"]
    });

    const child = spawnMock.mock.results[0]?.value as any;
    expect(child.__capturedStdin()).toBe("hi");
  });

  it("forwards output to tee streams when provided", async () => {
    vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ stdout: "agent output", stderr: "agent progress", exitCode: 0 })
    );

    let teeStdout = "";
    let teeStderr = "";
    const result = await spawn("codex", {
      prompt: "hello",
      tee: {
        stdout: {
          write: (chunk: string) => {
            teeStdout += chunk;
          }
        },
        stderr: {
          write: (chunk: string) => {
            teeStderr += chunk;
          }
        }
      }
    });

    expect(result.stdout).toBe("agent output");
    expect(result.stderr).toBe("agent progress");
    expect(teeStdout).toBe("agent output");
    expect(teeStderr).toBe("agent progress");
  });

  it("kills the child and rejects with AbortError when the signal aborts", async () => {
    const controller = new AbortController();
    const child = createMockChildProcess({ autoClose: false });
    const killSpy = vi.spyOn(child, "kill");
    vi.mocked(spawnChildProcess).mockReturnValue(child);

    const resultPromise = spawn("codex", {
      prompt: "hello",
      signal: controller.signal
    });

    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(killSpy).toHaveBeenCalledWith("SIGTERM");
  });

  it("appends edit mode args when mode is 'edit'", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockChildProcess({ exitCode: 0 }));

    await spawn("claude-code", { prompt: "test", mode: "edit" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "test",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.edit
    ]);
  });

  it("appends read mode args when mode is 'read'", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockChildProcess({ exitCode: 0 }));

    await spawn("claude-code", { prompt: "test", mode: "read" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "test",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.read
    ]);
  });

  it("returns early without spawning when dryRun is true", async () => {
    const spawnMock = vi.mocked(spawnChildProcess);
    const dryRunMessages: string[] = [];

    const result = await spawn(
      "claude-code",
      { prompt: "test" },
      {
        dryRun: true,
        logger: { dryRun: (msg) => dryRunMessages.push(msg) }
      }
    );

    expect(spawnMock).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(dryRunMessages).toHaveLength(1);
    expect(dryRunMessages[0]).toContain("claude");
  });

  it("records the expected otel span lifecycle for a CLI spawn", async () => {
    const events: string[] = [];
    const sink = createRecordingOtelSink(events);
    vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ stdout: "finished\n", exitCode: 0 })
    );

    await spawn("codex", {
      prompt: "Inspect.",
      mode: "read",
      cwd: "/repo",
      otelSink: sink
    });

    expect(events).toEqual([
      'start:agent.spawn:{"agent":"codex","mode":"read","cwd":"/repo"}',
      'event:prompt:{"prompt":"Inspect."}',
      'event:summary:{"summary":"finished"}',
      'event:exit:{"exitCode":0}',
      "end"
    ]);
  });

  it("records an otel exception when a CLI spawn rejects", async () => {
    const events: string[] = [];
    const sink = createRecordingOtelSink(events);
    const failure = new Error("spawn exploded");
    vi.mocked(spawnChildProcess).mockImplementation(() => {
      throw failure;
    });

    await expect(spawn("codex", { prompt: "Try.", otelSink: sink })).rejects.toThrow(
      "spawn exploded"
    );

    expect(events.filter((event) => event === "exception:spawn exploded")).toHaveLength(1);
    expect(events.at(-1)).toBe("end");
  });

  it("does not crash CLI spawns when otel sink methods throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const span = {
      setAttribute: vi.fn(() => {
        throw new Error("set failed");
      }),
      addEvent: vi.fn(() => {
        throw new Error("event failed");
      }),
      end: vi.fn(() => {
        throw new Error("end failed");
      })
    };
    const sink: OtelSink = {
      startSpan: vi.fn(() => span),
      recordException: vi.fn(() => {
        throw new Error("exception failed");
      })
    };
    const failure = new Error("spawn exploded");
    vi.mocked(spawnChildProcess).mockImplementation(() => {
      throw failure;
    });

    await expect(spawn("codex", { prompt: "Try.", otelSink: sink })).rejects.toThrow(
      "spawn exploded"
    );

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("spawn.retry streams attempt-prefixed events from each retry attempt", async () => {
    vi.mocked(spawnChildProcess)
      .mockImplementationOnce(() =>
        createMockChildProcess({
          stdoutLines: [
            JSON.stringify({
              type: "item.completed",
              item: { type: "agent_message", text: "first" }
            })
          ],
          exitCode: 1
        })
      )
      .mockImplementationOnce(() =>
        createMockChildProcess({
          stdoutLines: [
            JSON.stringify({
              type: "item.completed",
              item: { type: "agent_message", text: "second" }
            })
          ],
          exitCode: 0
        })
      );

    const { events, result } = spawn.retry(
      "codex",
      { prompt: "hello" },
      { maxAttempts: 2, backoffMs: 1 }
    );
    const eventsPromise = collect(events).then(stripMeta);

    await expect(result).resolves.toEqual({ stdout: "", stderr: "", exitCode: 0 });
    await expect(eventsPromise).resolves.toEqual([
      { event: "agent_message", text: "attempt: 1 first" },
      { event: "agent_message", text: "attempt: 1 wait 1ms before retry" },
      { event: "agent_message", text: "attempt: 2 second" }
    ]);
    expect(spawnChildProcess).toHaveBeenCalledTimes(2);
  });

  it("spawn.retry records otel spans for each retry attempt", async () => {
    const otelEvents: string[] = [];
    vi.mocked(spawnChildProcess)
      .mockImplementationOnce(() =>
        createMockChildProcess({
          stdoutLines: [
            JSON.stringify({
              type: "item.completed",
              item: { type: "agent_message", text: "first" }
            })
          ],
          exitCode: 1
        })
      )
      .mockImplementationOnce(() =>
        createMockChildProcess({
          stdoutLines: [
            JSON.stringify({
              type: "item.completed",
              item: { type: "agent_message", text: "second" }
            })
          ],
          exitCode: 0
        })
      );

    const { events, result } = spawn.retry(
      "codex",
      { prompt: "hello", cwd: "/repo", otelSink: createRecordingOtelSink(otelEvents) },
      { maxAttempts: 2, backoffMs: 1 }
    );

    await Promise.all([collect(events), result]);

    expect(otelEvents).toEqual([
      'start:agent.spawn:{"agent":"codex","mode":"yolo","cwd":"/repo"}',
      'event:prompt:{"prompt":"hello"}',
      'event:summary:{"summary":""}',
      'event:exit:{"exitCode":1}',
      "end",
      'start:agent.spawn:{"agent":"codex","mode":"yolo","cwd":"/repo"}',
      'event:prompt:{"prompt":"hello"}',
      'event:summary:{"summary":""}',
      'event:exit:{"exitCode":0}',
      "end"
    ]);
  });

  it("falls back to prompt args when stdin is unsupported", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockChildProcess({ stdout: "ok\n", exitCode: 0 }));

    await spawn("opencode", { prompt: "hello", useStdin: true });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, spawnOptions] = spawnMock.mock.calls[0]!;
    expect(command).toBe("opencode");
    expect(args).toEqual([
      openCodeSpawnConfig.promptFlag,
      "hello",
      ...openCodeSpawnConfig.defaultArgs,
      ...openCodeSpawnConfig.modes.yolo
    ]);
    expect(spawnOptions).toMatchObject({
      stdio: ["inherit", "pipe", "pipe"]
    });

    const child = spawnMock.mock.results[0]?.value as any;
    expect(child.__capturedStdin()).toBe("");
  });

  describe("activityTimeoutMs", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("kills process and rejects with ActivityTimeoutError after inactivity", async () => {
      const child = createMockChildProcess({ autoClose: false });
      const killSpy = vi.spyOn(child, "kill");
      vi.mocked(spawnChildProcess).mockReturnValue(child);

      const resultPromise = spawn("codex", {
        prompt: "hello",
        activityTimeoutMs: 5000
      });

      const rejection = expect(resultPromise).rejects.toMatchObject({
        name: "ActivityTimeoutError"
      });

      await vi.advanceTimersByTimeAsync(5000);

      await rejection;
      expect(killSpy).toHaveBeenCalledWith("SIGTERM");
    });

    it("resets timeout when stdout data is received", async () => {
      const child = createMockChildProcess({ autoClose: false });
      const streams = child as unknown as { stdout: PassThrough; stderr: PassThrough };
      const killSpy = vi.spyOn(child, "kill");
      vi.mocked(spawnChildProcess).mockReturnValue(child);

      const resultPromise = spawn("codex", {
        prompt: "hello",
        activityTimeoutMs: 5000
      });

      const rejection = expect(resultPromise).rejects.toMatchObject({
        name: "ActivityTimeoutError"
      });

      // Advance 4s, send data, advance another 4s — should not timeout
      await vi.advanceTimersByTimeAsync(4000);
      streams.stdout.write("some output");
      await vi.advanceTimersByTimeAsync(4000);
      expect(killSpy).not.toHaveBeenCalled();

      // Now let it timeout
      await vi.advanceTimersByTimeAsync(1001);
      await rejection;
    });

    it("resets timeout when stderr data is received", async () => {
      const child = createMockChildProcess({ autoClose: false });
      const streams = child as unknown as { stdout: PassThrough; stderr: PassThrough };
      const killSpy = vi.spyOn(child, "kill");
      vi.mocked(spawnChildProcess).mockReturnValue(child);

      const resultPromise = spawn("codex", {
        prompt: "hello",
        activityTimeoutMs: 5000
      });

      const rejection = expect(resultPromise).rejects.toMatchObject({
        name: "ActivityTimeoutError"
      });

      await vi.advanceTimersByTimeAsync(4000);
      streams.stderr.write("progress info");
      await vi.advanceTimersByTimeAsync(4000);
      expect(killSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1001);
      await rejection;
    });

    it("clears timeout when process exits normally", async () => {
      const child = createMockChildProcess({ autoClose: false });
      const streams = child as unknown as { stdout: PassThrough; stderr: PassThrough };
      vi.mocked(spawnChildProcess).mockReturnValue(child);

      const resultPromise = spawn("codex", {
        prompt: "hello",
        activityTimeoutMs: 5000
      });

      await vi.waitFor(() => expect(spawnChildProcess).toHaveBeenCalledTimes(1));

      // Process exits before timeout
      streams.stdout.end();
      streams.stderr.end();
      child.emit("close", 0, null);

      const result = await resultPromise;
      expect(result.exitCode).toBe(0);
    });
  });
});

function createRecordingOtelSink(events: string[]): OtelSink {
  return {
    startSpan(name, attrs) {
      events.push(`start:${name}:${JSON.stringify(attrs)}`);
      return {
        setAttribute(key, value) {
          events.push(`attr:${key}:${JSON.stringify(value)}`);
        },
        addEvent(name, attrs) {
          events.push(`event:${name}:${JSON.stringify(attrs)}`);
        },
        end() {
          events.push("end");
        }
      };
    },
    recordException(_span, error) {
      events.push(`exception:${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

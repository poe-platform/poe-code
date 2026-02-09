import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as spawnChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { claudeCodeSpawnConfig } from "./configs/claude-code.js";
import { codexSpawnConfig } from "./configs/codex.js";
import { openCodeSpawnConfig } from "./configs/opencode.js";
import { spawn } from "./spawn.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

interface MockChildProcessOptions {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
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
  };
  childStreams.stdin = stdin;
  childStreams.stdout = stdout;
  childStreams.stderr = stderr;

  let capturedStdin = "";
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk) => {
    capturedStdin += chunk;
  });
  (child as any).__capturedStdin = () => capturedStdin;

  const exitCode = options.exitCode ?? 0;
  const output = options.stdout ?? "";
  const errorOutput = options.stderr ?? "";

  queueMicrotask(() => {
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

  return child;
}

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
    await expect(spawn("claude-desktop", { prompt: "test" })).rejects.toThrow(/has no spawn config/);
    await expect(spawn("claude-desktop", { prompt: "test" })).rejects.not.toThrow(/Unknown agent/);
    expect(vi.mocked(spawnChildProcess)).not.toHaveBeenCalled();
  });

  it("spawns CLI using promptFlag + prompt + defaultArgs + options.args", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ stdout: "ok\n", exitCode: 0 })
    );

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
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ exitCode: 0 })
    );

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

  // IMPORTANT: CLI binaries (claude, codex, etc.) only accept bare model IDs
  // (e.g. "claude-opus-4.6"), not namespaced ones (e.g. "anthropic/claude-opus-4.6").
  // The namespace MUST be stripped here in agent-spawn before invoking the binary.
  // Do NOT remove this stripping — it will break all spawns that pass a namespaced model.
  it("strips provider namespace from model before passing to CLI", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ exitCode: 0 })
    );

    await spawn("claude-code", { prompt: "test", model: "anthropic/claude-opus-4.6" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("claude-opus-4.6");
    expect(args).not.toContain("anthropic/claude-opus-4.6");
  });

  it("passes cwd option to the spawned process", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ exitCode: 0 })
    );

    await spawn("codex", { prompt: "hello", cwd: "/tmp/poe-agent-spawn" });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, , options] = spawnMock.mock.calls[0];
    expect(options).toEqual(expect.objectContaining({ cwd: "/tmp/poe-agent-spawn" }));
  });

  it("writes prompt to stdin when useStdin is enabled and supported", async () => {
    const cwd = "/repo";
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ stdout: "ok\n", exitCode: 0 })
    );

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
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ stdout: "ok\n", exitCode: 0 })
    );

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
        stdout: { write: (chunk: string) => { teeStdout += chunk; } },
        stderr: { write: (chunk: string) => { teeStderr += chunk; } }
      }
    });

    expect(result.stdout).toBe("agent output");
    expect(result.stderr).toBe("agent progress");
    expect(teeStdout).toBe("agent output");
    expect(teeStderr).toBe("agent progress");
  });

  it("appends edit mode args when mode is 'edit'", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ exitCode: 0 })
    );

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
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ exitCode: 0 })
    );

    await spawn("claude-code", { prompt: "test", mode: "read" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "test",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.read
    ]);
  });

  it("falls back to prompt args when stdin is unsupported", async () => {
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ stdout: "ok\n", exitCode: 0 })
    );

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
});

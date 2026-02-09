import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn as spawnChildProcess, type ChildProcess } from "node:child_process";
import { resolveConfig } from "./configs/resolve-config.js";
import { claudeCodeSpawnConfig } from "./configs/claude-code.js";
import { codexSpawnConfig } from "./configs/codex.js";
import { openCodeSpawnConfig } from "./configs/opencode.js";
import { kimiSpawnConfig } from "./configs/kimi.js";
import { spawnInteractive } from "./spawn-interactive.js";

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

  queueMicrotask(() => {
    child.emit("close", exitCode, null);
  });

  return child;
}

describe("spawnInteractive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws if agent ID cannot be resolved", async () => {
    await expect(spawnInteractive("unknown", { prompt: "test" })).rejects.toThrow(
      /Unknown agent/
    );
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
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockInheritProcess(0));

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
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("codex", { prompt: "test prompt" });

    const [command, args] = spawnMock.mock.calls[0];
    expect(command).toBe("codex");
    expect(args).toEqual(["test prompt", ...codexSpawnConfig.interactive!.defaultArgs, ...codexSpawnConfig.modes.yolo]);
  });

  it("builds flag-based prompt args for opencode", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockInheritProcess(0));

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
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockInheritProcess(0));

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

  it("includes model flag when model is provided", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockInheritProcess(0));

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

  it("strips provider namespace from model before passing to CLI", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("claude-code", { prompt: "test", model: "anthropic/claude-opus-4.6" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("claude-opus-4.6");
    expect(args).not.toContain("anthropic/claude-opus-4.6");
  });

  it("spawns with stdio inherit for all streams", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockInheritProcess(0));

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
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("codex", { prompt: "test", cwd: "/my/project" });

    const [, , options] = spawnMock.mock.calls[0];
    expect(options).toEqual(expect.objectContaining({ cwd: "/my/project" }));
  });

  it("omits prompt args when prompt is empty", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("claude-code", { prompt: "" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      ...claudeCodeSpawnConfig.interactive!.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo
    ]);
  });

  it("omits prompt flag when prompt is empty for flag-based agents", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockInheritProcess(0));

    await spawnInteractive("opencode", { prompt: "" });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      ...openCodeSpawnConfig.interactive!.defaultArgs,
      ...openCodeSpawnConfig.modes.yolo
    ]);
    expect(args).not.toContain(openCodeSpawnConfig.interactive!.promptFlag);
  });

  it("appends extra args from options", async () => {
    const spawnMock = vi
      .mocked(spawnChildProcess)
      .mockReturnValue(createMockInheritProcess(0));

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
});

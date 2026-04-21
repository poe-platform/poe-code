import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as spawnChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";

const hoisted = vi.hoisted(() => {
  const { Volume, createFsFromVolume } = require("memfs") as typeof import("memfs");
  const volume = new Volume();
  const memFs = createFsFromVolume(volume);
  return { volume, memFs };
});

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

vi.mock("node:fs", () => hoisted.memFs);

import { spawn } from "./spawn.js";

function createMockChildProcess({
  stdout = "",
  stderr = "",
  exitCode = 0
}: { stdout?: string; stderr?: string; exitCode?: number } = {}): ChildProcessWithoutNullStreams {
  const stdin = new PassThrough();
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  (child as unknown as { stdin: PassThrough }).stdin = stdin;
  (child as unknown as { stdout: PassThrough }).stdout = stdoutStream;
  (child as unknown as { stderr: PassThrough }).stderr = stderrStream;
  (child as unknown as { kill: () => boolean }).kill = () => {
    child.emit("close", 1);
    return true;
  };

  queueMicrotask(() => {
    if (stdout) stdoutStream.write(stdout);
    stdoutStream.end();
    if (stderr) stderrStream.write(stderr);
    stderrStream.end();
    child.emit("close", exitCode, null);
  });

  return child;
}

describe("spawn() with logDir + logFileName", () => {
  beforeEach(() => {
    hoisted.volume.reset();
    vi.mocked(spawnChildProcess).mockReset();
  });

  it("appends stdout and stderr to logPath and returns logFile", async () => {
    vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ stdout: "hello\n", stderr: "warn\n", exitCode: 0 })
    );

    const result = await spawn("claude-code", {
      prompt: "test",
      logDir: "/tmp/ignored",
      logFileName: "ignored.jsonl",
      logPath: "/tmp/run-logs/20260418-200000-000-builder.jsonl"
    });

    expect(result.logFile).toBe("/tmp/run-logs/20260418-200000-000-builder.jsonl");
    expect(result.exitCode).toBe(0);

    const contents = hoisted.memFs.readFileSync(
      "/tmp/run-logs/20260418-200000-000-builder.jsonl",
      "utf8"
    );
    expect(contents).toBe("hello\nwarn\n");
  });

  it("appends stdout and stderr to <logDir>/<logFileName> and returns logFile", async () => {
    vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ stdout: "hello\n", stderr: "warn\n", exitCode: 0 })
    );

    const result = await spawn("claude-code", {
      prompt: "test",
      logDir: "/tmp/run-logs",
      logFileName: "20260418-200000-000-builder.jsonl"
    });

    expect(result.logFile).toBe("/tmp/run-logs/20260418-200000-000-builder.jsonl");
    expect(result.exitCode).toBe(0);

    const contents = hoisted.memFs.readFileSync(
      "/tmp/run-logs/20260418-200000-000-builder.jsonl",
      "utf8"
    );
    expect(contents).toBe("hello\nwarn\n");
  });

  it("omits logFile when only logDir is provided", async () => {
    vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ stdout: "ok\n", exitCode: 0 })
    );

    const result = await spawn("claude-code", {
      prompt: "test",
      logDir: "/tmp/run-logs"
    });

    expect(result.logFile).toBeUndefined();
  });

  it("omits logFile when neither option is provided", async () => {
    vi.mocked(spawnChildProcess).mockReturnValue(
      createMockChildProcess({ stdout: "ok\n", exitCode: 0 })
    );

    const result = await spawn("claude-code", { prompt: "test" });

    expect(result.logFile).toBeUndefined();
  });
});

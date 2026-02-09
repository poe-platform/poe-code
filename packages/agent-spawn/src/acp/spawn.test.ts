import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as spawnChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";

import { spawnStreaming } from "./spawn.js";
import { codexSpawnConfig } from "../configs/codex.js";
import { openCodeSpawnConfig } from "../configs/opencode.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

interface MockChildProcessOptions {
  stdoutLines?: string[];
  stderr?: string;
  exitCode?: number;
}

function createMockChildProcess(
  options: MockChildProcessOptions = {}
): { child: ChildProcessWithoutNullStreams; stdin: PassThrough; getStdin(): string } {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();

  let stdinBuffer = "";
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk) => {
    stdinBuffer += String(chunk);
  });

  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  const childStreams = child as unknown as {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
  };
  childStreams.stdin = stdin;
  childStreams.stdout = stdout;
  childStreams.stderr = stderr;

  const exitCode = options.exitCode ?? 0;
  const lines = options.stdoutLines ?? [];
  const errorOutput = options.stderr ?? "";

  queueMicrotask(() => {
    for (const line of lines) {
      stdout.write(`${line}\n`, "utf8");
    }
    stdout.end();

    if (errorOutput) {
      stderr.write(errorOutput, "utf8");
    }
    stderr.end();

    child.emit("close", exitCode, null);
  });

  return { child, stdin, getStdin: () => stdinBuffer };
}

describe("acp/spawnStreaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams OpenCode JSON events via the opencode adapter", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({
          type: "text",
          sessionID: "ses_abc",
          part: { type: "text", messageID: "msg_1", text: "hi" }
        }),
        JSON.stringify({
          type: "step_finish",
          sessionID: "ses_abc",
          part: { tokens: { input: 1, output: 2, cache: { read: 3, write: 0 } } }
        })
      ],
      stderr: "warn\n",
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "hello",
      cwd: "/tmp"
    });

    await expect(collect(events)).resolves.toEqual([
      { event: "session_start", threadId: "ses_abc" },
      { event: "agent_message", text: "hi" },
      { event: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 3 }
    ]);

    await expect(done).resolves.toMatchObject({
      exitCode: 0,
      threadId: "ses_abc",
      sessionId: "ses_abc",
      usage: { inputTokens: 1, outputTokens: 2, cachedTokens: 3 },
      stderr: "warn\n"
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, spawnOptions] = spawnMock.mock.calls[0];
    expect(command).toBe("opencode");
    expect(args).toEqual([openCodeSpawnConfig.promptFlag, "hello", ...openCodeSpawnConfig.defaultArgs, ...openCodeSpawnConfig.modes.yolo]);
    expect(spawnOptions).toMatchObject({ cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] });
  });

  it("writes prompt to stdin when useStdin is true and stdinMode is available", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({ type: "thread.started", thread_id: "t1" }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "hi" }
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 1, output_tokens: 2, cached_input_tokens: 0 }
        })
      ],
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "codex",
      prompt: "hello from stdin",
      useStdin: true
    });

    await expect(collect(events)).resolves.toEqual([
      { event: "session_start", threadId: "t1" },
      { event: "agent_message", text: "hi" },
      { event: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 0 }
    ]);

    await expect(done).resolves.toMatchObject({
      exitCode: 0,
      threadId: "t1",
      sessionId: "t1",
      usage: { inputTokens: 1, outputTokens: 2, cachedTokens: 0 }
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      codexSpawnConfig.promptFlag,
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo,
      ...codexSpawnConfig.stdinMode!.extraArgs
    ]);
    expect(mock.getStdin()).toBe("hello from stdin");
  });

  it("strips provider namespace from model before passing to CLI", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
      ],
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "claude-code",
      prompt: "test",
      model: "anthropic/claude-opus-4.6"
    });

    await collect(events);
    await done;

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("claude-opus-4.6");
    expect(args).not.toContain("anthropic/claude-opus-4.6");
  });

  it("throws on unknown agentId before spawning", () => {
    const spawnMock = vi.mocked(spawnChildProcess);
    expect(() =>
      spawnStreaming({
        agentId: "unknown",
        prompt: "hello"
      })
    ).toThrow('Unknown agent "unknown".');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("throws error if agent has no spawn config", () => {
    const spawnMock = vi.mocked(spawnChildProcess);
    expect(() =>
      spawnStreaming({
        agentId: "claude-desktop",
        prompt: "hello"
      })
    ).toThrow('Agent "claude-desktop" has no spawn config.');
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

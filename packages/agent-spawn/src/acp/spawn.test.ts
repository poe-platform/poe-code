import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as spawnChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";

import { spawnStreaming } from "./spawn.js";
import * as adapterModule from "../adapters/index.js";
import { codexSpawnConfig } from "../configs/codex.js";
import { openCodeSpawnConfig } from "../configs/opencode.js";
import { getMcpArgs } from "../mcp-args.js";
import type { CliSpawnConfig } from "../types.js";

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
  autoClose?: boolean;
  error?: Error;
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
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };
  childStreams.stdin = stdin;
  childStreams.stdout = stdout;
  childStreams.stderr = stderr;
  childStreams.kill = () => {
    child.emit("close", 1, "SIGTERM");
    return true;
  };

  const exitCode = options.exitCode ?? 0;
  const lines = options.stdoutLines ?? [];
  const errorOutput = options.stderr ?? "";
  const error = options.error;

  if (options.autoClose !== false) {
    queueMicrotask(() => {
      for (const line of lines) {
        stdout.write(`${line}\n`, "utf8");
      }
      stdout.end();

      if (errorOutput) {
        stderr.write(errorOutput, "utf8");
      }
      stderr.end();

      if (error) {
        child.emit("error", error);
        return;
      }

      child.emit("close", exitCode, null);
    });
  }

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

    await expect(done).resolves.toEqual({
      stdout: "",
      stderr: "warn\n",
      exitCode: 0
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, spawnOptions] = spawnMock.mock.calls[0];
    expect(command).toBe("opencode");
    expect(args).toEqual([openCodeSpawnConfig.promptFlag, "hello", ...openCodeSpawnConfig.defaultArgs, ...openCodeSpawnConfig.modes.yolo]);
    expect(spawnOptions).toMatchObject({ cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] });
  });

  it("passes through multiple usage events without accumulating into done", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({
          type: "text",
          sessionID: "ses_agg",
          part: { type: "text", messageID: "msg_1", text: "hi" }
        }),
        JSON.stringify({
          type: "step_finish",
          sessionID: "ses_agg",
          part: { tokens: { input: 1, output: 2, cache: { read: 3, write: 0 } } }
        }),
        JSON.stringify({
          type: "step_finish",
          sessionID: "ses_agg",
          part: { tokens: { input: 4, output: 5, cache: { read: 6, write: 0 } } }
        })
      ],
      exitCode: 0
    });

    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "hello"
    });

    await expect(collect(events)).resolves.toEqual([
      { event: "session_start", threadId: "ses_agg" },
      { event: "agent_message", text: "hi" },
      { event: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 3 },
      { event: "usage", inputTokens: 4, outputTokens: 5, cachedTokens: 6 }
    ]);

    const final = await done;
    expect(final).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    expect(final.threadId).toBeUndefined();
    expect(final.sessionId).toBeUndefined();
    expect(final.usage).toBeUndefined();
  });

  it("ignores non-ACP adapter outputs and yields only raw ACP events", async () => {
    const mock = createMockChildProcess({ exitCode: 0 });
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const getAdapterMock = vi.spyOn(adapterModule, "getAdapter").mockReturnValue(
      async function* () {
        yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ignore me" } };
        yield { event: "agent_message", text: "raw event" };
      }
    );
    try {
      const { events, done } = spawnStreaming({
        agentId: "codex",
        prompt: "hello"
      });

      await expect(collect(events)).resolves.toEqual([{ event: "agent_message", text: "raw event" }]);
      await expect(done).resolves.toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0
      });

      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(getAdapterMock).toHaveBeenCalledWith("codex");
    } finally {
      getAdapterMock.mockRestore();
    }
  });

  it("rejects done when child process emits error", async () => {
    const mock = createMockChildProcess({ error: new Error("spawn failed") });
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "hello"
    });

    const doneRejection = expect(done).rejects.toThrow("spawn failed");
    await expect(collect(events)).resolves.toEqual([]);
    await doneRejection;
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

    await expect(done).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0
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

  // IMPORTANT: CLI binaries (claude, codex, etc.) only accept bare model IDs
  // (e.g. "claude-opus-4-6"), not namespaced ones (e.g. "anthropic/claude-opus-4.6").
  // The namespace MUST be stripped and dots converted to hyphens before invoking the binary.
  // Do NOT remove this stripping — it will break all spawns that pass a namespaced model.
  it("strips provider namespace and transforms model before passing to CLI", async () => {
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
    expect(args).toContain("claude-opus-4-6");
    expect(args).not.toContain("anthropic/claude-opus-4.6");
    expect(args).not.toContain("claude-opus-4.6");
  });

  it("applies modelTransform for opencode models (bare)", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({
          type: "text",
          sessionID: "ses_abc",
          part: { type: "text", messageID: "msg_1", text: "hi" }
        }),
      ],
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "test",
      model: "gpt-5.2"
    });

    await collect(events);
    await done;

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("poe/gpt-5.2");
    expect(args).not.toContain("gpt-5.2");
  });

  it("applies modelTransform for opencode models (namespaced)", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({
          type: "text",
          sessionID: "ses_abc",
          part: { type: "text", messageID: "msg_1", text: "hi" }
        }),
      ],
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "opencode",
      prompt: "test",
      model: "openai/gpt-5.2"
    });

    await collect(events);
    await done;

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("poe/openai/gpt-5.2");
    expect(args).not.toContain("openai/gpt-5.2");
  });

  it("serializes MCP servers for streaming spawn when supported", async () => {
    const mock = createMockChildProcess({
      stdoutLines: [
        JSON.stringify({ type: "thread.started", thread_id: "t1" })
      ],
      exitCode: 0
    });

    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { events, done } = spawnStreaming({
      agentId: "codex",
      prompt: "hello",
      mcpServers: {
        test: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { MCP_LOG_LEVEL: "debug" }
        }
      }
    });

    await collect(events);
    await done;

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      "-c",
      "mcp_servers.test.command=\"tiny-stdio-mcp-test-server\"",
      "-c",
      "mcp_servers.test.args=[\"serve\", \"word-of-the-day\"]",
      "-c",
      "mcp_servers.test.env={\"MCP_LOG_LEVEL\"=\"debug\"}",
      codexSpawnConfig.promptFlag,
      "hello",
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
  });

  it("throws a clear error when MCP config is passed to unsupported agents", () => {
    const fakeConfig = { kind: "cli" as const, agentId: "fake-agent" } as CliSpawnConfig;
    expect(() =>
      getMcpArgs(fakeConfig, { test: { command: "tiny-stdio-mcp-test-server" } })
    ).toThrow('Agent "fake-agent" does not support MCP servers at spawn time.');
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

  it("kills the child and rejects with AbortError when the signal aborts", async () => {
    const controller = new AbortController();
    const mock = createMockChildProcess({ autoClose: false });
    const killSpy = vi.spyOn(mock.child, "kill");
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);

    const { done } = spawnStreaming({
      agentId: "codex",
      prompt: "hello",
      signal: controller.signal
    });

    controller.abort();

    await expect(done).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(killSpy).toHaveBeenCalledWith("SIGTERM");
  });
});

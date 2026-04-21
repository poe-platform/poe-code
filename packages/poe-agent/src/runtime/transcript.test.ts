import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { AcpEvent } from "./types.js";
import {
  createTranscriptWriter,
  mapAcpEventToSessionUpdates,
  type TranscriptFsApi
} from "./transcript.js";

function createMemfs(): {
  memfs: ReturnType<typeof createFsFromVolume>["promises"];
  transcriptFs: TranscriptFsApi;
} {
  const memfs = createFsFromVolume(new Volume()).promises;
  return {
    memfs,
    transcriptFs: {
      async mkdir(dir: string, options: { recursive: true }) {
        await memfs.mkdir(dir, options);
      },
      async appendFile(filePath: string, contents: string) {
        await memfs.appendFile(filePath, contents, "utf8");
      }
    }
  };
}

describe("mapAcpEventToSessionUpdates", () => {
  it("maps message.delta to agent_message_chunk", () => {
    expect(
      mapAcpEventToSessionUpdates({ type: "message.delta", content: "hello" }),
    ).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
    ]);
  });

  it("skips empty message.delta chunks", () => {
    expect(
      mapAcpEventToSessionUpdates({ type: "message.delta", content: "" }),
    ).toEqual([]);
  });

  it("maps tool.intent to a tool_call + in_progress tool_call_update pair", () => {
    expect(
      mapAcpEventToSessionUpdates({
        type: "tool.intent",
        intentId: "abc",
        tool: "read_file",
        args: { path: "/tmp/x" },
      }),
    ).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "abc",
        title: "read_file",
        kind: "execute",
        status: "pending",
        rawInput: { path: "/tmp/x" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "abc",
        kind: "execute",
        status: "in_progress",
      },
    ]);
  });

  it("maps tool.result to a completed tool_call_update", () => {
    expect(
      mapAcpEventToSessionUpdates({
        type: "tool.result",
        intentId: "abc",
        result: "ok",
      }),
    ).toEqual([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "abc",
        kind: "execute",
        status: "completed",
        rawOutput: "ok",
      },
    ]);
  });

  it("maps tool.error to a failed tool_call_update", () => {
    expect(
      mapAcpEventToSessionUpdates({
        type: "tool.error",
        intentId: "abc",
        error: "boom",
      }),
    ).toEqual([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "abc",
        kind: "execute",
        status: "failed",
        rawOutput: "boom",
      },
    ]);
  });

  it("maps usage to a usage_update with non-cached input and meta", () => {
    expect(
      mapAcpEventToSessionUpdates({
        type: "usage",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 20,
          cacheCreationTokens: 0,
        },
      }),
    ).toEqual([
      {
        sessionUpdate: "usage_update",
        used: 80,
        size: 100,
        _meta: {
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 20,
          cacheCreationTokens: 0,
        },
      },
    ]);
  });

  it("ignores events with no replay representation", () => {
    const unmapped: AcpEvent[] = [
      { type: "session.complete", result: { output: "x", messages: [], toolCalls: [] } },
      { type: "session.error", error: new Error("boom") },
      { type: "progress", message: "thinking" },
      { type: "fork.start", forkId: "f1", prompt: "branch" },
      { type: "fork.complete", forkId: "f1", result: { output: "done", messages: [] } },
      { type: "fork.error", forkId: "f1", error: "failed" },
    ];

    for (const event of unmapped) {
      expect(mapAcpEventToSessionUpdates(event)).toEqual([]);
    }
  });
});

describe("createTranscriptWriter", () => {
  it("accepts logPath directly", async () => {
    const { memfs, transcriptFs } = createMemfs();
    const writer = createTranscriptWriter({
      logPath: "/logs/round.jsonl",
      fs: transcriptFs,
    });

    await writer.write({ type: "message.delta", content: "hi" });

    expect(writer.filePath).toBe("/logs/round.jsonl");
    await expect(memfs.readFile("/logs/round.jsonl", "utf8")).resolves.toBe(
      `${JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } })}\n`,
    );
  });

  it("writes a JSON line per mapped SessionUpdate", async () => {
    const { memfs, transcriptFs } = createMemfs();
    const mkdirSpy = vi.spyOn(transcriptFs, "mkdir");
    const appendFileSpy = vi.spyOn(transcriptFs, "appendFile");
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs: transcriptFs,
    });

    await writer.write({ type: "message.delta", content: "hi" });

    expect(mkdirSpy).toHaveBeenCalledTimes(1);
    expect(mkdirSpy).toHaveBeenCalledWith("/logs", { recursive: true });
    expect(appendFileSpy).toHaveBeenCalledTimes(1);
    expect(writer.filePath).toBe("/logs/round.jsonl");
    await expect(memfs.readFile("/logs/round.jsonl", "utf8")).resolves.toBe(
      `${JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } })}\n`,
    );
  });

  it("writes two lines for a tool.intent event", async () => {
    const { memfs, transcriptFs } = createMemfs();
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs: transcriptFs,
    });

    await writer.write({
      type: "tool.intent",
      intentId: "1",
      tool: "shell",
      args: { cmd: "ls" },
    });

    const lines = (await memfs.readFile("/logs/round.jsonl", "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).sessionUpdate).toBe("tool_call");
    expect(JSON.parse(lines[1]!).sessionUpdate).toBe("tool_call_update");
  });

  it("only calls mkdir once across multiple writes", async () => {
    const { transcriptFs } = createMemfs();
    const mkdirSpy = vi.spyOn(transcriptFs, "mkdir");
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs: transcriptFs,
    });

    await writer.write({ type: "message.delta", content: "a" });
    await writer.write({ type: "message.delta", content: "b" });
    await writer.write({ type: "message.delta", content: "c" });

    expect(mkdirSpy).toHaveBeenCalledTimes(1);
  });

  it("does not touch the filesystem for unmapped events", async () => {
    const { transcriptFs } = createMemfs();
    const mkdirSpy = vi.spyOn(transcriptFs, "mkdir");
    const appendFileSpy = vi.spyOn(transcriptFs, "appendFile");
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs: transcriptFs,
    });

    await writer.write({
      type: "session.complete",
      result: { output: "done", messages: [], toolCalls: [] },
    });

    expect(mkdirSpy).not.toHaveBeenCalled();
    expect(appendFileSpy).not.toHaveBeenCalled();
  });

  it("uses the injected pathJoin when computing the output path", async () => {
    const { transcriptFs } = createMemfs();
    const appendFileSpy = vi.spyOn(transcriptFs, "appendFile");
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs: transcriptFs,
      pathJoin: (...parts) => parts.join("::"),
    });

    await writer.write({ type: "message.delta", content: "hi" });

    expect(writer.filePath).toBe("/logs::round.jsonl");
    expect(appendFileSpy).toHaveBeenCalledWith(
      "/logs::round.jsonl",
      `${JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } })}\n`,
    );
  });

  it("silently disables itself on fs write failures instead of throwing", async () => {
    const { memfs, transcriptFs } = createMemfs();
    await memfs.mkdir("/logs", { recursive: true });
    await memfs.mkdir("/logs/round.jsonl", { recursive: true });
    const appendFileSpy = vi.spyOn(transcriptFs, "appendFile");
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs: transcriptFs,
    });

    await expect(writer.write({ type: "message.delta", content: "hi" })).resolves.toBeUndefined();
    await expect(writer.write({ type: "message.delta", content: "more" })).resolves.toBeUndefined();

    expect(appendFileSpy).toHaveBeenCalledTimes(1);
  });

  it("silently disables itself when an event cannot be serialized", async () => {
    const { transcriptFs } = createMemfs();
    const appendFileSpy = vi.spyOn(transcriptFs, "appendFile");
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs: transcriptFs,
    });
    const circular: { self?: unknown } = {};
    circular.self = circular;

    await expect(
      writer.write({
        type: "tool.intent",
        intentId: "1",
        tool: "shell",
        args: circular,
      }),
    ).resolves.toBeUndefined();
    await expect(writer.write({ type: "message.delta", content: "after" })).resolves.toBeUndefined();

    expect(appendFileSpy).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import type { AcpEvent } from "@poe-code/poe-agent";
import {
  createTranscriptWriter,
  mapAcpEventToSessionUpdates,
  type TranscriptFsApi
} from "./poe-agent-transcript.js";

describe("mapAcpEventToSessionUpdates", () => {
  it("maps message.delta to agent_message_chunk", () => {
    expect(
      mapAcpEventToSessionUpdates({ type: "message.delta", content: "hello" })
    ).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } }
    ]);
  });

  it("skips empty message.delta chunks", () => {
    expect(
      mapAcpEventToSessionUpdates({ type: "message.delta", content: "" })
    ).toEqual([]);
  });

  it("maps tool.intent to a tool_call + in_progress tool_call_update pair", () => {
    expect(
      mapAcpEventToSessionUpdates({
        type: "tool.intent",
        intentId: "abc",
        tool: "read_file",
        args: { path: "/tmp/x" }
      })
    ).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "abc",
        title: "read_file",
        kind: "execute",
        status: "pending",
        rawInput: { path: "/tmp/x" }
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "abc",
        kind: "execute",
        status: "in_progress"
      }
    ]);
  });

  it("maps tool.result to a completed tool_call_update", () => {
    expect(
      mapAcpEventToSessionUpdates({
        type: "tool.result",
        intentId: "abc",
        result: "ok"
      })
    ).toEqual([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "abc",
        kind: "execute",
        status: "completed",
        rawOutput: "ok"
      }
    ]);
  });

  it("maps tool.error to a failed tool_call_update", () => {
    expect(
      mapAcpEventToSessionUpdates({
        type: "tool.error",
        intentId: "abc",
        error: "boom"
      })
    ).toEqual([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "abc",
        kind: "execute",
        status: "failed",
        rawOutput: "boom"
      }
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
          cacheCreationTokens: 0
        }
      })
    ).toEqual([
      {
        sessionUpdate: "usage_update",
        used: 80,
        size: 100,
        _meta: {
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 20,
          cacheCreationTokens: 0
        }
      }
    ]);
  });

  it("ignores events with no replay representation (session.complete, session.error, fork.*, progress)", () => {
    const unmapped: AcpEvent[] = [
      { type: "session.complete", result: { output: "x", messages: [], toolCalls: [] } },
      { type: "session.error", error: new Error("boom") },
      { type: "progress", message: "thinking" }
    ];
    for (const event of unmapped) {
      expect(mapAcpEventToSessionUpdates(event)).toEqual([]);
    }
  });
});

describe("createTranscriptWriter", () => {
  function createFakeFs(): {
    fs: TranscriptFsApi;
    calls: { appendFile: Array<{ path: string; contents: string }>; mkdir: string[] };
  } {
    const calls = {
      appendFile: [] as Array<{ path: string; contents: string }>,
      mkdir: [] as string[]
    };
    return {
      calls,
      fs: {
        async mkdir(dir: string) {
          calls.mkdir.push(dir);
        },
        async appendFile(filePath: string, contents: string) {
          calls.appendFile.push({ path: filePath, contents });
        }
      }
    };
  }

  it("writes a JSON line per mapped SessionUpdate", async () => {
    const { fs, calls } = createFakeFs();
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs
    });

    await writer.write({ type: "message.delta", content: "hi" });

    expect(calls.mkdir).toEqual(["/logs"]);
    expect(calls.appendFile).toHaveLength(1);
    expect(calls.appendFile[0]?.path).toBe("/logs/round.jsonl");
    const parsed = JSON.parse(calls.appendFile[0]!.contents.trim());
    expect(parsed).toEqual({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hi" }
    });
  });

  it("writes two lines for a tool.intent event (tool_call + in_progress update)", async () => {
    const { fs, calls } = createFakeFs();
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs
    });

    await writer.write({
      type: "tool.intent",
      intentId: "1",
      tool: "shell",
      args: { cmd: "ls" }
    });

    expect(calls.appendFile).toHaveLength(1);
    const lines = calls.appendFile[0]!.contents.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).sessionUpdate).toBe("tool_call");
    expect(JSON.parse(lines[1]!).sessionUpdate).toBe("tool_call_update");
  });

  it("only calls mkdir once across multiple writes", async () => {
    const { fs, calls } = createFakeFs();
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs
    });

    await writer.write({ type: "message.delta", content: "a" });
    await writer.write({ type: "message.delta", content: "b" });
    await writer.write({ type: "message.delta", content: "c" });

    expect(calls.mkdir).toEqual(["/logs"]);
    expect(calls.appendFile).toHaveLength(3);
  });

  it("silently disables itself on fs write failures instead of throwing", async () => {
    const fs: TranscriptFsApi = {
      async mkdir() {
        throw new Error("no permission");
      },
      async appendFile() {
        // should never be called
      }
    };
    const appendSpy = vi.spyOn(fs, "appendFile");
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs
    });

    await expect(writer.write({ type: "message.delta", content: "hi" })).resolves.toBeUndefined();
    expect(appendSpy).not.toHaveBeenCalled();

    // Subsequent writes should also be no-ops (disabled flag).
    await writer.write({ type: "message.delta", content: "more" });
    expect(appendSpy).not.toHaveBeenCalled();
  });
});

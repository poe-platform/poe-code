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
      },
      async lstat(filePath: string) {
        return memfs.lstat(filePath);
      }
    }
  };
}

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

describe("mapAcpEventToSessionUpdates", () => {
  it("maps message.delta to agent_message_chunk", () => {
    expect(mapAcpEventToSessionUpdates({ type: "message.delta", content: "hello" })).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } }
    ]);
  });

  it("skips empty message.delta chunks", () => {
    expect(mapAcpEventToSessionUpdates({ type: "message.delta", content: "" })).toEqual([]);
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

  it("ignores events with no replay representation", () => {
    const unmapped: AcpEvent[] = [
      {
        type: "session.complete",
        result: {
          output: "x",
          stdout: "x",
          summary: "x",
          messages: [],
          toolCalls: [],
          exitCode: 0,
          stderr: ""
        }
      },
      { type: "session.error", error: new Error("boom") },
      { type: "progress", message: "thinking" },
      { type: "fork.start", forkId: "f1", prompt: "branch" },
      { type: "fork.complete", forkId: "f1", result: { output: "done", messages: [] } },
      { type: "fork.error", forkId: "f1", error: "failed" }
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
      fs: transcriptFs
    });

    await writer.write({ type: "message.delta", content: "hi" });

    expect(writer.filePath).toBe("/logs/round.jsonl");
    await expect(memfs.readFile("/logs/round.jsonl", "utf8")).resolves.toBe(
      `${JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } })}\n`
    );
  });

  it("writes a JSON line per mapped SessionUpdate", async () => {
    const { memfs, transcriptFs } = createMemfs();
    const mkdirSpy = vi.spyOn(transcriptFs, "mkdir");
    const appendFileSpy = vi.spyOn(transcriptFs, "appendFile");
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs: transcriptFs
    });

    await writer.write({ type: "message.delta", content: "hi" });

    expect(mkdirSpy).toHaveBeenCalledTimes(1);
    expect(mkdirSpy).toHaveBeenCalledWith("/logs", { recursive: true });
    expect(appendFileSpy).toHaveBeenCalledTimes(1);
    expect(writer.filePath).toBe("/logs/round.jsonl");
    await expect(memfs.readFile("/logs/round.jsonl", "utf8")).resolves.toBe(
      `${JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } })}\n`
    );
  });

  it("writes two lines for a tool.intent event", async () => {
    const { memfs, transcriptFs } = createMemfs();
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs: transcriptFs
    });

    await writer.write({
      type: "tool.intent",
      intentId: "1",
      tool: "shell",
      args: { cmd: "ls" }
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
      fs: transcriptFs
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
      fs: transcriptFs
    });

    await writer.write({
      type: "session.complete",
      result: {
        output: "done",
        stdout: "done",
        summary: "done",
        messages: [],
        toolCalls: [],
        exitCode: 0,
        stderr: ""
      }
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
      pathJoin: (...parts) => parts.join("::")
    });

    await writer.write({ type: "message.delta", content: "hi" });

    expect(writer.filePath).toBe("/logs::round.jsonl");
    expect(appendFileSpy).toHaveBeenCalledWith(
      "/logs::round.jsonl",
      `${JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } })}\n`
    );
  });

  it("surfaces fs write failures and permits a later retry", async () => {
    const { memfs, transcriptFs } = createMemfs();
    const appendFileSpy = vi.spyOn(transcriptFs, "appendFile")
      .mockRejectedValueOnce(new Error("write failed"));
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs: transcriptFs
    });

    await expect(writer.write({ type: "message.delta", content: "hi" })).rejects.toThrow("write failed");
    await expect(writer.write({ type: "message.delta", content: "more" })).resolves.toBeUndefined();

    expect(appendFileSpy).toHaveBeenCalledTimes(2);
    await expect(memfs.readFile("/logs/round.jsonl", "utf8")).resolves.toContain("more");
  });

  it("does not append through a symlinked transcript file", async () => {
    const { memfs, transcriptFs } = createMemfs();
    await memfs.mkdir("/logs", { recursive: true });
    await memfs.mkdir("/outside", { recursive: true });
    await memfs.writeFile("/outside/transcript.jsonl", "original\n", "utf8");
    await memfs.symlink("/outside/transcript.jsonl", "/logs/round.jsonl");
    const writer = createTranscriptWriter({
      logPath: "/logs/round.jsonl",
      fs: transcriptFs
    });

    await expect(writer.write({ type: "message.delta", content: "external transcript" })).rejects.toThrow(
      "Transcript log path may not contain symbolic links"
    );

    await expect(memfs.readFile("/outside/transcript.jsonl", "utf8")).resolves.toBe("original\n");
  });

  it("does not append through a symlinked transcript directory", async () => {
    const { memfs, transcriptFs } = createMemfs();
    await memfs.mkdir("/logs", { recursive: true });
    await memfs.mkdir("/outside", { recursive: true });
    await memfs.symlink("/outside", "/logs/linked");
    const writer = createTranscriptWriter({
      logDir: "/logs/linked",
      logFileName: "round.jsonl",
      fs: transcriptFs
    });

    await expect(writer.write({ type: "message.delta", content: "external transcript" })).rejects.toThrow(
      "Transcript log path may not contain symbolic links"
    );

    await expect(memfs.readdir("/outside")).resolves.toEqual([]);
  });

  it("does not treat inherited lstat codes as missing transcript paths", async () => {
    const { memfs, transcriptFs } = createMemfs();
    const lstatError = new Error("lstat denied");
    transcriptFs.lstat = async (filePath: string) => {
      if (filePath === "/logs") {
        throw lstatError;
      }
      return memfs.lstat(filePath);
    };
    const writer = createTranscriptWriter({
      logPath: "/logs/round.jsonl",
      fs: transcriptFs
    });

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(writer.write({ type: "message.delta", content: "hi" })).rejects.toBe(
        lstatError
      );
    });
  });

  it("surfaces an event that cannot be serialized without disabling later writes", async () => {
    const { transcriptFs } = createMemfs();
    const appendFileSpy = vi.spyOn(transcriptFs, "appendFile");
    const writer = createTranscriptWriter({
      logDir: "/logs",
      logFileName: "round.jsonl",
      fs: transcriptFs
    });
    const circular: { self?: unknown } = {};
    circular.self = circular;

    await expect(
      writer.write({
        type: "tool.intent",
        intentId: "1",
        tool: "shell",
        args: circular
      })
    ).rejects.toThrow();
    await expect(
      writer.write({ type: "message.delta", content: "after" })
    ).resolves.toBeUndefined();

    expect(appendFileSpy).toHaveBeenCalledTimes(1);
  });
});

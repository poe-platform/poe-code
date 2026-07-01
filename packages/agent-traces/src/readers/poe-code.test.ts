import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { poeCodeTraceReader } from "./poe-code.js";
import type { AgentTraceFileSystem } from "../types.js";

describe("poeCodeTraceReader", () => {
  it("discovers spawn log JSONL files from the default root", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.poe-code/spawn-logs/20260701-192947-526-codex-b65c65af-8890-4034-be7c-d4caa92346c4.jsonl":
          JSON.stringify({
            event: "session_start",
            threadId: "thread-one",
            _meta: { ts: 1782934187526 }
          }),
        "/home/me/.poe-code/spawn-logs/not-a-log.txt": "ignored"
      })
    ).promises;

    const references = await poeCodeTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      fs
    });

    expect(poeCodeTraceReader.defaultRoots("/home/me")).toEqual(["/home/me/.poe-code/spawn-logs"]);
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      source: "poe-code",
      id: "b65c65af-8890-4034-be7c-d4caa92346c4",
      path: "/home/me/.poe-code/spawn-logs/20260701-192947-526-codex-b65c65af-8890-4034-be7c-d4caa92346c4.jsonl",
      title: "codex"
    });
    expect(references[0]?.cwd).toBeUndefined();
  });

  it("parses hyphenated agent names when the session id is UUID-shaped", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.poe-code/spawn-logs/20260701-192947-526-gemini-cli-b65c65af-8890-4034-be7c-d4caa92346c4.jsonl":
          ""
      })
    ).promises;

    const references = await poeCodeTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      fs
    });

    expect(references).toEqual([
      {
        source: "poe-code",
        id: "b65c65af-8890-4034-be7c-d4caa92346c4",
        path: "/home/me/.poe-code/spawn-logs/20260701-192947-526-gemini-cli-b65c65af-8890-4034-be7c-d4caa92346c4.jsonl",
        updatedAt: expect.any(Date),
        title: "gemini-cli"
      }
    ]);
  });

  it("filters discovered spawn logs by updatedAt", async () => {
    const baseFs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.poe-code/spawn-logs/20260701-192947-526-codex-old-session.jsonl": "",
        "/home/me/.poe-code/spawn-logs/20260702-192947-526-codex-new-session.jsonl": ""
      })
    ).promises;
    const fs: AgentTraceFileSystem = {
      ...baseFs,
      async stat(filePath: string) {
        const stats = await baseFs.stat(filePath);
        return {
          isFile: () => stats.isFile(),
          isDirectory: () => stats.isDirectory(),
          mtime: filePath.includes("new-session")
            ? new Date("2026-07-02T19:29:47.526Z")
            : new Date("2026-07-01T19:29:47.526Z")
        };
      }
    };

    const references = await poeCodeTraceReader.discover({
      homeDir: "/home/me",
      since: new Date("2026-07-02T00:00:00.000Z"),
      fs
    });

    expect(references.map((reference) => reference.id)).toEqual(["new-session"]);
  });

  it("falls back to the filename timestamp when stat mtime is unavailable", async () => {
    const baseFs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.poe-code/spawn-logs/20260701-192947-526-codex-session-five.jsonl": ""
      })
    ).promises;
    const fs: AgentTraceFileSystem = {
      ...baseFs,
      async stat(filePath: string) {
        const stats = await baseFs.stat(filePath);
        return {
          isFile: () => stats.isFile(),
          isDirectory: () => stats.isDirectory()
        };
      }
    };

    const references = await poeCodeTraceReader.discover({
      homeDir: "/home/me",
      since: new Date("2026-07-01T19:29:47.526Z"),
      fs
    });
    const filtered = await poeCodeTraceReader.discover({
      homeDir: "/home/me",
      since: new Date("2026-07-01T19:29:47.527Z"),
      fs
    });

    expect(references).toMatchObject([
      {
        source: "poe-code",
        id: "session-five",
        updatedAt: new Date("2026-07-01T19:29:47.526Z"),
        title: "codex"
      }
    ]);
    expect(filtered).toEqual([]);
  });

  it("maps spawn log events to normalized turns and preserves redacted tool text", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.poe-code/spawn-logs/20260701-192947-526-codex-session-one.jsonl": [
          JSON.stringify({
            event: "session_start",
            threadId: "thread-one",
            _meta: { ts: 1782934187000 }
          }),
          "not json",
          JSON.stringify({
            event: "agent_message",
            text: "Starting.",
            _meta: { ts: 1782934188000 }
          }),
          JSON.stringify({
            event: "reasoning",
            text: "Need inspect.",
            _meta: { ts: 1782934189000 }
          }),
          JSON.stringify({
            event: "tool_start",
            kind: "exec_command",
            title: "[redacted]",
            id: "call-one",
            _meta: { ts: 1782934190000 }
          }),
          JSON.stringify({
            event: "tool_complete",
            kind: "exec_command",
            path: "[redacted]",
            id: "call-one",
            _meta: { ts: 1782934191000 }
          }),
          JSON.stringify({
            event: "error",
            message: "spawn failed",
            _meta: { ts: 1782934192000 }
          }),
          JSON.stringify({
            event: "usage",
            inputTokens: 10,
            outputTokens: 2,
            cachedTokens: 4,
            cacheCreationTokens: 1
          })
        ].join("\n")
      })
    ).promises;

    const trace = await poeCodeTraceReader.read(
      {
        source: "poe-code",
        id: "session-one",
        path: "/home/me/.poe-code/spawn-logs/20260701-192947-526-codex-session-one.jsonl",
        updatedAt: new Date("2026-07-01T19:29:47.526Z"),
        title: "codex"
      },
      { fs }
    );

    expect(trace).toMatchObject({
      source: "poe-code",
      id: "session-one",
      model: "codex",
      title: "codex",
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        cachedTokens: 4,
        cacheCreationTokens: 1,
        contextTokens: 12,
        source: "reported"
      }
    });
    expect(trace.turns).toEqual([
      {
        role: "assistant",
        text: "Starting.",
        timestamp: new Date(1782934188000)
      },
      {
        role: "assistant",
        text: "Need inspect.",
        timestamp: new Date(1782934189000),
        sourceKind: "reasoning"
      },
      {
        id: "call-one",
        role: "tool",
        text: "[redacted]",
        timestamp: new Date(1782934190000),
        sourceKind: "tool_use",
        toolName: "exec_command"
      },
      {
        id: "call-one",
        role: "tool",
        text: "[redacted]",
        timestamp: new Date(1782934191000),
        sourceKind: "tool_result",
        toolName: "exec_command"
      },
      {
        role: "system",
        text: "spawn failed",
        timestamp: new Date(1782934192000)
      }
    ]);
  });

  it("uses the last usage event", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.poe-code/spawn-logs/20260701-192947-526-gemini-session-two.jsonl": [
          JSON.stringify({ event: "usage", inputTokens: 1, outputTokens: 2 }),
          JSON.stringify({
            event: "usage",
            inputTokens: 20,
            outputTokens: 5,
            cachedTokens: 10
          }),
          JSON.stringify({
            event: "spawn_result",
            exitCode: 0,
            usage: { inputTokens: 100, outputTokens: 50 }
          })
        ].join("\n")
      })
    ).promises;

    const trace = await poeCodeTraceReader.read(
      {
        source: "poe-code",
        id: "session-two",
        path: "/home/me/.poe-code/spawn-logs/20260701-192947-526-gemini-session-two.jsonl",
        title: "gemini"
      },
      { fs }
    );

    expect(trace.usage).toEqual({
      inputTokens: 20,
      outputTokens: 5,
      cachedTokens: 10,
      contextTokens: 25,
      source: "reported"
    });
  });

  it("falls back to spawn_result usage when no usage events exist", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.poe-code/spawn-logs/20260701-192947-526-claude-session-three.jsonl":
          JSON.stringify({
            event: "spawn_result",
            exitCode: 0,
            usage: {
              inputTokens: 30,
              outputTokens: 7,
              cacheCreationTokens: 3
            }
          })
      })
    ).promises;

    const trace = await poeCodeTraceReader.read(
      {
        source: "poe-code",
        id: "session-three",
        path: "/home/me/.poe-code/spawn-logs/20260701-192947-526-claude-session-three.jsonl",
        title: "claude"
      },
      { fs }
    );

    expect(trace.usage).toEqual({
      inputTokens: 30,
      outputTokens: 7,
      cacheCreationTokens: 3,
      contextTokens: 37,
      source: "reported"
    });
  });

  it("reads session_start plus error logs without usage", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.poe-code/spawn-logs/20260701-192947-526-codex-session-four.jsonl": [
          JSON.stringify({ event: "session_start", threadId: "thread-four" }),
          JSON.stringify({ event: "error", message: "failed before usage" })
        ].join("\n")
      })
    ).promises;

    const trace = await poeCodeTraceReader.read(
      {
        source: "poe-code",
        id: "session-four",
        path: "/home/me/.poe-code/spawn-logs/20260701-192947-526-codex-session-four.jsonl",
        title: "codex"
      },
      { fs }
    );

    expect(trace.usage).toBeUndefined();
    expect(trace.turns).toEqual([
      {
        role: "system",
        text: "failed before usage"
      }
    ]);
  });
});

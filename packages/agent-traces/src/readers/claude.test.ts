import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { claudeTraceReader } from "./claude.js";

describe("claudeTraceReader", () => {
  it("discovers workspace JSONL sessions and extracts human text turns", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/trace-one.jsonl": [
          JSON.stringify({
            type: "user",
            sessionId: "session-one",
            uuid: "turn-one",
            cwd: "/repo",
            timestamp: "2026-06-13T12:00:00.000Z",
            message: {
              role: "user",
              content: [
                { type: "text", text: "Please implement the parser." },
                { type: "tool_result", content: "ignore tool output" },
                { text: "Did you test it?" }
              ]
            }
          }),
          "not json",
          JSON.stringify({
            type: "assistant",
            sessionId: "session-one",
            message: { role: "assistant", content: "done" }
          })
        ].join("\n"),
        "/home/me/.claude/projects/-other/trace-two.jsonl": JSON.stringify({
          type: "user",
          sessionId: "session-two",
          cwd: "/other",
          timestamp: "2026-06-13T13:00:00.000Z",
          message: { role: "user", content: "Ignore other workspace" }
        })
      })
    ).promises;

    const references = await claudeTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      fs
    });

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      source: "claude",
      id: "session-one",
      cwd: "/repo"
    });

    const trace = await claudeTraceReader.read(references[0]!, { fs });

    expect(trace.turns).toEqual([
      {
        id: "turn-one",
        role: "human",
        text: "Please implement the parser.\nDid you test it?",
        timestamp: new Date("2026-06-13T12:00:00.000Z"),
        sourceKind: "user"
      },
      {
        role: "assistant",
        text: "done",
        sourceKind: "assistant"
      }
    ]);
  });

  it("scans every Claude project when allWorkspaces is true", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/home/me/.claude/projects/-repo/one.jsonl": JSON.stringify({
          type: "user",
          sessionId: "one",
          cwd: "/repo",
          message: { role: "user", content: "one" }
        }),
        "/home/me/.claude/projects/-other/two.jsonl": JSON.stringify({
          type: "user",
          sessionId: "two",
          cwd: "/other",
          message: { role: "user", content: "two" }
        })
      })
    ).promises;

    const references = await claudeTraceReader.discover({
      cwd: "/repo",
      homeDir: "/home/me",
      allWorkspaces: true,
      fs
    });

    expect(references.map((reference) => reference.id).sort()).toEqual(["one", "two"]);
  });
});

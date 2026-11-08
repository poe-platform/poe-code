import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { claudeTraceReader } from "../readers/claude.js";
import { piTraceReader } from "../readers/pi.js";
import { poeCodeTraceReader } from "../readers/poe-code.js";
import type { AgentTraceFileSystem } from "../types.js";
import { openTraceIndex } from "./store.js";

const HOME = "/home/me";
const INDEX_DIR = `${HOME}/.cache/poe-code/trace-index`;

function makeFs(): AgentTraceFileSystem {
  return createFsFromVolume(
    Volume.fromJSON({
      [`${HOME}/.claude/projects/-repo/session-a.jsonl`]: JSON.stringify({
        type: "user",
        sessionId: "claude-a",
        cwd: "/repo",
        timestamp: "2026-07-20T10:00:00.000Z",
        message: { role: "user", content: "Fix the parser" }
      }),
      [`${HOME}/.pi/agent/sessions/--repo--/session-b.jsonl`]: [
        JSON.stringify({ type: "session", id: "pi-b", cwd: "/repo", timestamp: "2026-07-21T10:00:00.000Z" }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-07-21T10:00:01.000Z",
          message: { role: "user", content: "Review the diff" }
        })
      ].join("\n"),
      [`${HOME}/.poe-code/spawn-logs/20260722-101500-000-claude-run1.jsonl`]: JSON.stringify({
        event: "agent_message",
        text: "Working on the fix"
      })
    })
  ).promises as unknown as AgentTraceFileSystem;
}

describe("trace index with real readers", () => {
  it("produces the same references as direct discover", async () => {
    const fs = makeFs();
    const readers = [claudeTraceReader, piTraceReader, poeCodeTraceReader];

    const direct = (
      await Promise.all(
        readers.map((reader) => reader.discover({ homeDir: HOME, fs, allWorkspaces: true }))
      )
    ).flat();

    const index = await openTraceIndex({ dir: INDEX_DIR, fs });
    await index.sync({ readers, homeDir: HOME });
    const indexed = await index.query({ limit: 100, allWorkspaces: true });

    const byId = (references: typeof indexed) =>
      [...references].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(indexed)).toEqual(byId(direct));
    expect(indexed.map((reference) => reference.id).sort()).toEqual(["claude-a", "pi-b", "run1"]);
  });
});

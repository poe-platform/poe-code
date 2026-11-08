import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { AgentTraceFileSystem, TraceReference } from "@poe-code/agent-traces";
import { listTraces } from "./loader.js";

const HOME = "/trace-index-test-home";
const INDEX_DIR = "/cache/trace-index";

function makeFs(): AgentTraceFileSystem {
  return createFsFromVolume(
    Volume.fromJSON({
      [`${HOME}/.claude/projects/-repo/session-a.jsonl`]: JSON.stringify({
        type: "user",
        sessionId: "claude-a",
        cwd: "/repo",
        timestamp: "2026-07-20T10:00:00.000Z",
        message: { role: "user", content: "Fix the parser" }
      })
    })
  ).promises as unknown as AgentTraceFileSystem;
}

const failingSqlite = async (): Promise<never> => {
  const error = new Error("no sqlite in tests") as Error & { code: string };
  error.code = "ENOENT";
  throw error;
};

function baseOptions(fs: AgentTraceFileSystem) {
  return {
    cwd: "/repo",
    homeDir: HOME,
    fs,
    allWorkspaces: true,
    indexDir: INDEX_DIR,
    sqlite: failingSqlite
  };
}

describe("listTraces index modes", () => {
  it("sync mode builds the index and answers from it without full-file reads", async () => {
    const fs = makeFs();
    const first = await listTraces({ ...baseOptions(fs), index: "sync" });
    expect(first.map((reference) => reference.id)).toEqual(["claude-a"]);
    await expect(fs.readFile(`${INDEX_DIR}/manifest.json`, "utf8")).resolves.toContain("shards");

    const readFileSpy = vi.spyOn(fs, "readFile");
    const second = await listTraces({ ...baseOptions(fs), index: "sync" });
    expect(second.map((reference) => reference.id)).toEqual(["claude-a"]);
    const traceReads = readFileSpy.mock.calls.filter(([file]) =>
      String(file).startsWith(`${HOME}/.claude`)
    );
    expect(traceReads).toEqual([]);
  });

  it("background mode returns stale rows immediately and revalidates once", async () => {
    const fs = makeFs();
    const updates: TraceReference[][] = [];
    const updated = new Promise<TraceReference[]>((resolve) => {
      const initial = listTraces({
        ...baseOptions(fs),
        index: "background",
        onIndexUpdate: (references) => {
          updates.push(references);
          resolve(references);
        }
      });
      void initial.then((references) => {
        expect(references).toEqual([]);
      });
    });

    const revalidated = await updated;
    expect(revalidated.map((reference) => reference.id)).toEqual(["claude-a"]);
    expect(updates).toHaveLength(1);
  });

  it("off mode never touches the index directory", async () => {
    const fs = makeFs();
    const references = await listTraces({ ...baseOptions(fs), index: "off" });
    expect(references.map((reference) => reference.id)).toEqual(["claude-a"]);
    await expect(fs.readFile(`${INDEX_DIR}/manifest.json`, "utf8")).rejects.toThrow();
  });

  it("rebuildIndex drops stale index entries", async () => {
    const fs = makeFs();
    await listTraces({ ...baseOptions(fs), index: "sync" });
    const volume = fs as unknown as { unlink(path: string): Promise<void> };
    await volume.unlink(`${HOME}/.claude/projects/-repo/session-a.jsonl`);

    const rebuilt = await listTraces({ ...baseOptions(fs), index: "sync", rebuildIndex: true });
    expect(rebuilt).toEqual([]);
  });
});

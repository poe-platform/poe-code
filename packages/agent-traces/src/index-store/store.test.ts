import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentTraceFileSystem,
  TraceHeadMetadata,
  TraceReader,
  TraceScanDirectory
} from "../types.js";
import { openTraceIndex } from "./store.js";

const INDEX_DIR = "/home/me/.cache/poe-code/trace-index";
const NOW = new Date("2026-07-24T12:00:00.000Z").getTime();
const RECENT = "2026-07-24T10:00:00.000Z";
const OLD = "2026-01-01T10:00:00.000Z";

function makeFs(files: Record<string, string>): AgentTraceFileSystem {
  return createFsFromVolume(Volume.fromJSON(files)).promises as unknown as AgentTraceFileSystem;
}

function fakeReader(root: string, options?: { source?: TraceReader["id"] }): TraceReader {
  return {
    id: options?.source ?? "claude",
    defaultRoots: () => [root],
    discover: async () => [],
    read: async () => {
      throw new Error("not used");
    },
    async *scan({ fs }): AsyncIterable<TraceScanDirectory> {
      let names: string[];
      try {
        names = await fs.readdir(root);
      } catch {
        return;
      }
      for (const name of names.sort()) {
        const directory = `${root}/${name}`;
        if (!(await fs.stat(directory)).isDirectory()) {
          continue;
        }
        const files = (await fs.readdir(directory))
          .filter((file) => file.endsWith(".jsonl"))
          .sort()
          .map((file) => `${directory}/${file}`);
        yield { directory, files };
      }
    },
    readHeadMetadata(head, filePath): TraceHeadMetadata | undefined {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(head.split("\n")[0] ?? "") as Record<string, unknown>;
      } catch {
        return undefined;
      }
      if (parsed.skip === true) {
        return undefined;
      }
      return {
        id: typeof parsed.id === "string" ? parsed.id : filePath,
        ...(typeof parsed.cwd === "string" ? { cwd: parsed.cwd } : {}),
        ...(typeof parsed.title === "string" ? { title: parsed.title } : {})
      };
    }
  };
}

async function utimes(fs: AgentTraceFileSystem, filePath: string, iso: string): Promise<void> {
  const time = new Date(iso);
  await (
    fs as unknown as { utimes(path: string, atime: Date, mtime: Date): Promise<void> }
  ).utimes(filePath, time, time);
}

describe("openTraceIndex", () => {
  it("indexes scanned files and queries newest-first with a limit", async () => {
    const fs = makeFs({
      "/traces/dir-a/one.jsonl": JSON.stringify({ id: "one", cwd: "/repo", title: "One" }),
      "/traces/dir-a/two.jsonl": JSON.stringify({ id: "two", cwd: "/repo", title: "Two" }),
      "/traces/dir-b/three.jsonl": JSON.stringify({ id: "three", cwd: "/other", title: "Three" })
    });
    await utimes(fs, "/traces/dir-a/one.jsonl", "2026-07-20T00:00:00.000Z");
    await utimes(fs, "/traces/dir-a/two.jsonl", "2026-07-22T00:00:00.000Z");
    await utimes(fs, "/traces/dir-b/three.jsonl", "2026-07-21T00:00:00.000Z");

    const index = await openTraceIndex({ dir: INDEX_DIR, fs });
    const stats = await index.sync({ readers: [fakeReader("/traces")], homeDir: "/home/me", now: () => NOW });

    expect(stats.added).toBe(3);
    expect(stats.headReads).toBe(3);

    const references = await index.query({ limit: 2, allWorkspaces: true });
    expect(references.map((reference) => reference.id)).toEqual(["two", "three"]);
    expect(references[0]?.title).toBe("Two");
    expect(references[0]?.updatedAt).toEqual(new Date("2026-07-22T00:00:00.000Z"));
  });

  it("does not re-read unchanged files on a second sync", async () => {
    const fs = makeFs({
      "/traces/dir-a/one.jsonl": JSON.stringify({ id: "one", title: "One" })
    });
    await utimes(fs, "/traces/dir-a/one.jsonl", RECENT);
    const readFileSpy = vi.spyOn(fs, "readFile");

    const index = await openTraceIndex({ dir: INDEX_DIR, fs });
    await index.sync({ readers: [fakeReader("/traces")], homeDir: "/home/me", now: () => NOW });

    readFileSpy.mockClear();
    const stats = await index.sync({
      readers: [fakeReader("/traces")],
      homeDir: "/home/me",
      now: () => NOW
    });
    expect(stats.headReads).toBe(0);
    expect(stats.added + stats.updated + stats.removed).toBe(0);
    const traceReads = readFileSpy.mock.calls.filter(([file]) =>
      String(file).startsWith("/traces/")
    );
    expect(traceReads).toEqual([]);
  });

  it("skips stat entirely for cold files outside the hot window", async () => {
    const fs = makeFs({
      "/traces/dir-a/old.jsonl": JSON.stringify({ id: "old", title: "Old" })
    });
    await utimes(fs, "/traces/dir-a/old.jsonl", OLD);

    const index = await openTraceIndex({ dir: INDEX_DIR, fs });
    await index.sync({ readers: [fakeReader("/traces")], homeDir: "/home/me", now: () => NOW });

    const statSpy = vi.spyOn(fs, "stat");
    const stats = await index.sync({
      readers: [fakeReader("/traces")],
      homeDir: "/home/me",
      now: () => NOW
    });
    expect(stats.statted).toBe(0);
    const traceStats = statSpy.mock.calls.filter(([file]) => String(file).endsWith(".jsonl"));
    expect(traceStats).toEqual([]);
  });

  it("re-indexes a changed hot file and moves it to the top", async () => {
    const fs = makeFs({
      "/traces/dir-a/one.jsonl": JSON.stringify({ id: "one", title: "Old title" }),
      "/traces/dir-a/two.jsonl": JSON.stringify({ id: "two", title: "Two" })
    });
    await utimes(fs, "/traces/dir-a/one.jsonl", "2026-07-20T00:00:00.000Z");
    await utimes(fs, "/traces/dir-a/two.jsonl", "2026-07-22T00:00:00.000Z");

    const index = await openTraceIndex({ dir: INDEX_DIR, fs });
    await index.sync({ readers: [fakeReader("/traces")], homeDir: "/home/me", now: () => NOW });

    await fs.writeFile("/traces/dir-a/one.jsonl", JSON.stringify({ id: "one", title: "New title" }));
    await utimes(fs, "/traces/dir-a/one.jsonl", "2026-07-23T00:00:00.000Z");

    const stats = await index.sync({
      readers: [fakeReader("/traces")],
      homeDir: "/home/me",
      now: () => NOW
    });
    expect(stats.updated).toBe(1);
    expect(stats.headReads).toBe(1);

    const references = await index.query({ limit: 10, allWorkspaces: true });
    expect(references.map((reference) => reference.id)).toEqual(["one", "two"]);
    expect(references[0]?.title).toBe("New title");
  });

  it("prunes deleted files and vanished directories", async () => {
    const fs = makeFs({
      "/traces/dir-a/one.jsonl": JSON.stringify({ id: "one", title: "One" }),
      "/traces/dir-b/two.jsonl": JSON.stringify({ id: "two", title: "Two" })
    });
    await utimes(fs, "/traces/dir-a/one.jsonl", RECENT);
    await utimes(fs, "/traces/dir-b/two.jsonl", RECENT);

    const index = await openTraceIndex({ dir: INDEX_DIR, fs });
    await index.sync({ readers: [fakeReader("/traces")], homeDir: "/home/me", now: () => NOW });

    const volumeFs = fs as unknown as { unlink(path: string): Promise<void>; rmdir(path: string): Promise<void> };
    await volumeFs.unlink("/traces/dir-b/two.jsonl");
    await volumeFs.rmdir("/traces/dir-b");

    const stats = await index.sync({
      readers: [fakeReader("/traces")],
      homeDir: "/home/me",
      now: () => NOW
    });
    expect(stats.removed).toBe(1);
    const references = await index.query({ limit: 10, allWorkspaces: true });
    expect(references.map((reference) => reference.id)).toEqual(["one"]);
  });

  it("filters by cwd unless allWorkspaces is set and respects since", async () => {
    const fs = makeFs({
      "/traces/dir-a/one.jsonl": JSON.stringify({ id: "one", cwd: "/repo", title: "One" }),
      "/traces/dir-a/two.jsonl": JSON.stringify({ id: "two", cwd: "/other", title: "Two" })
    });
    await utimes(fs, "/traces/dir-a/one.jsonl", "2026-07-20T00:00:00.000Z");
    await utimes(fs, "/traces/dir-a/two.jsonl", "2026-07-22T00:00:00.000Z");

    const index = await openTraceIndex({ dir: INDEX_DIR, fs });
    await index.sync({ readers: [fakeReader("/traces")], homeDir: "/home/me", now: () => NOW });

    const scoped = await index.query({ limit: 10, cwd: "/repo" });
    expect(scoped.map((reference) => reference.id)).toEqual(["one"]);

    const since = await index.query({
      limit: 10,
      allWorkspaces: true,
      since: new Date("2026-07-21T00:00:00.000Z")
    });
    expect(since.map((reference) => reference.id)).toEqual(["two"]);
  });

  it("only reads the shards that can contribute to the limit", async () => {
    const files: Record<string, string> = {};
    for (let dir = 0; dir < 5; dir += 1) {
      for (let file = 0; file < 3; file += 1) {
        files[`/traces/dir-${dir}/t${file}.jsonl`] = JSON.stringify({
          id: `t-${dir}-${file}`,
          title: "x"
        });
      }
    }
    const fs = makeFs(files);
    for (let dir = 0; dir < 5; dir += 1) {
      for (let file = 0; file < 3; file += 1) {
        await utimes(
          fs,
          `/traces/dir-${dir}/t${file}.jsonl`,
          `2026-07-${String(10 + dir).padStart(2, "0")}T0${file}:00:00.000Z`
        );
      }
    }
    const index = await openTraceIndex({ dir: INDEX_DIR, fs });
    await index.sync({ readers: [fakeReader("/traces")], homeDir: "/home/me", now: () => NOW });

    const readFileSpy = vi.spyOn(fs, "readFile");
    const references = await index.query({ limit: 3, allWorkspaces: true });
    expect(references).toHaveLength(3);
    expect(references[0]?.id).toBe("t-4-2");
    const shardReads = readFileSpy.mock.calls.filter(([file]) =>
      String(file).includes("/shards/")
    );
    expect(shardReads.length).toBeLessThanOrEqual(2);
  });

  it("skips files the reader cannot identify and survives corrupt index files", async () => {
    const fs = makeFs({
      "/traces/dir-a/good.jsonl": JSON.stringify({ id: "good", title: "Good" }),
      "/traces/dir-a/bad.jsonl": JSON.stringify({ skip: true })
    });
    await utimes(fs, "/traces/dir-a/good.jsonl", RECENT);
    await utimes(fs, "/traces/dir-a/bad.jsonl", RECENT);

    const index = await openTraceIndex({ dir: INDEX_DIR, fs });
    await index.sync({ readers: [fakeReader("/traces")], homeDir: "/home/me", now: () => NOW });

    await fs.writeFile(`${INDEX_DIR}/manifest.json`, "{corrupt");
    const afterCorruption = await openTraceIndex({ dir: INDEX_DIR, fs });
    expect(await afterCorruption.query({ limit: 10, allWorkspaces: true })).toEqual([]);

    await afterCorruption.sync({
      readers: [fakeReader("/traces")],
      homeDir: "/home/me",
      now: () => NOW
    });
    const references = await afterCorruption.query({ limit: 10, allWorkspaces: true });
    expect(references.map((reference) => reference.id)).toEqual(["good"]);
  });

  it("rebuild drops the index and re-syncs from scratch", async () => {
    const fs = makeFs({
      "/traces/dir-a/one.jsonl": JSON.stringify({ id: "one", title: "One" })
    });
    await utimes(fs, "/traces/dir-a/one.jsonl", OLD);

    const index = await openTraceIndex({ dir: INDEX_DIR, fs });
    await index.sync({ readers: [fakeReader("/traces")], homeDir: "/home/me", now: () => NOW });

    const stats = await index.rebuild({
      readers: [fakeReader("/traces")],
      homeDir: "/home/me",
      now: () => NOW
    });
    expect(stats.added).toBe(1);
    const references = await index.query({ limit: 10, allWorkspaces: true });
    expect(references.map((reference) => reference.id)).toEqual(["one"]);
  });
});

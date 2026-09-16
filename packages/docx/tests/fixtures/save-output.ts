import { Volume } from "memfs";
import { vi } from "vitest";
import type { FileStat, FileSystem } from "@poe-code/safe-fs/core";

/** Original conditional adapter: all filesystem effects stay inside memfs. */
export function saveFixture() {
  const volume = Volume.fromJSON({ "/work/keep": "unrelated", "/work/output": "previous" });
  const stat = async (path: string): Promise<FileStat> => {
    const s = volume.lstatSync(path);
    return { type: s.isDirectory() ? "directory" : s.isSymbolicLink() ? "symlink" : "file",
      size: s.size, mode: s.mode, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, atimeMs: s.atimeMs,
      ino: s.ino, dev: s.dev, nlink: s.nlink, identityScope: volume, revision: s.mtimeMs };
  };
  const check = async (path: string, expected: FileStat | null) => {
    const actual = volume.existsSync(path) ? await stat(path) : null;
    const fields = expected?.type === "directory" ? ["ino", "dev", "type"] as const
      : ["ino", "dev", "type", "size", "revision", "ctimeMs", "nlink"] as const;
    if ((actual === null) !== (expected === null) || fields.some(key => actual?.[key] !== expected?.[key]))
      throw Object.assign(new Error("conditional collision"), { code: "EAGAIN" });
  };
  const fs = {
    capabilities: { atomicFileStaging: true, write: true },
    capabilitiesFor: vi.fn(async () => ({ atomicFileStaging: true, write: true })),
    stat, lstat: vi.fn(stat),
    compareEntry: vi.fn(async (path: string, peer: FileSystem, other: string) =>
      (await peer.lstat(other)).identityScope !== volume ? "unknown" : volume.statSync(path).ino === volume.statSync(other).ino ? "same" : "distinct"),
    createStagedFile: vi.fn<NonNullable<FileSystem["createStagedFile"]>>(async (directory, name, content, options) => {
      await check("/work", options.parent);
      if (content.type !== "file") throw new Error("Expected file");
      volume.mkdirSync(directory);
      volume.writeFileSync(`${directory}/${name}`, content.data);
      return { parent: { path: "/work", stat: await stat("/work") },
        directory: { path: directory, stat: await stat(directory) },
        file: { path: `${directory}/${name}`, stat: await stat(`${directory}/${name}`) } };
    }),
    publishStagedFile: vi.fn<NonNullable<FileSystem["publishStagedFile"]>>(async (stage, path, options) => {
      await check("/work", options.parent);
      await check(path, options.destination);
      volume.renameSync(stage.file.path, path);
    }),
    removeStagedFile: vi.fn<NonNullable<FileSystem["removeStagedFile"]>>(async stage => {
      volume.rmSync(stage.directory.path, { recursive: true });
    })
  } as unknown as FileSystem;
  const vfs = { filesystem: fs, open: vi.fn((path: string) => ({ async *[Symbol.asyncIterator]() {
    yield new Uint8Array(volume.readFileSync(path) as Uint8Array);
  } })) };
  const events: string[] = [];
  const staged = {
    write: vi.fn(async (chunk: Uint8Array) => { events.push("write"); volume.appendFileSync("/work/stage", chunk); }),
    close: vi.fn(async () => { events.push("close"); }),
    commit: vi.fn(async () => { events.push("commit"); volume.renameSync("/work/stage", "/work/output"); }),
    abort: vi.fn(async () => { events.push("abort"); volume.rmSync("/work/stage", { force: true }); })
  };
  const sink = { stage: vi.fn(async (_signal?: AbortSignal) => {
    events.push("stage"); volume.writeFileSync("/work/stage", "", { flag: "wx" }); return staged;
  }) };
  const bytes = (path = "/work/output") => new Uint8Array(volume.readFileSync(path) as Uint8Array);
  return { volume, fs, stat, vfs, sink, staged, events, bytes };
}

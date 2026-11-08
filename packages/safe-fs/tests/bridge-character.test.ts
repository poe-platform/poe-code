import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { createFsBridge, MemoryFileSystem, resolvePath } from "../src/core.js";
import type { DirectoryEntry, FileStat, FsBridgeCodec, FsOptions, ReadDirectoryOptions } from "../src/core.js";
import { createNodeFsBridge } from "../src/node/filesystem.js";

const characterMetadata: FileStat = {
  type: "character", mode: 0o020666, size: 0,
  atimeMs: 1, mtimeMs: 2, ctimeMs: 3,
};

const codec: FsBridgeCodec = {
  isEncoding: Buffer.isEncoding,
  encode(text, encoding) {
    if (!Buffer.isEncoding(encoding)) throw new TypeError("Invalid encoding");
    return Buffer.from(text, encoding);
  },
  decode(bytes, encoding) {
    if (!Buffer.isEncoding(encoding)) throw new TypeError("Invalid encoding");
    return Buffer.from(bytes).toString(encoding);
  },
};

class CharacterMetadataFileSystem extends MemoryFileSystem {
  override async stat(path: string, options?: FsOptions): Promise<FileStat> {
    options?.signal?.throwIfAborted();
    const resolved = resolvePath("/", path);
    return resolved === "/character" || resolved === "/link" ? { ...characterMetadata } : super.stat(path, options);
  }

  override async lstat(path: string, options?: FsOptions): Promise<FileStat> {
    options?.signal?.throwIfAborted();
    return resolvePath("/", path) === "/character" ? { ...characterMetadata } : super.lstat(path, options);
  }

  override async readdir(path: string, options?: ReadDirectoryOptions): Promise<DirectoryEntry[]> {
    const entries = await super.readdir(path, options);
    return resolvePath("/", path) === "/" ? [...entries, { name: "character", type: "character" }] : entries;
  }
}

async function fixture(node: boolean) {
  const fs = new CharacterMetadataFileSystem();
  await fs.writeFile("/regular", new Uint8Array([1]));
  await fs.mkdir("/directory");
  await fs.writeFile("/directory/note", new Uint8Array([2]));
  await fs.symlink("/character", "/link");
  return node ? createNodeFsBridge(fs) : createFsBridge(fs, { codec });
}

describe.each([false, true])("character metadata bridge (node=%s)", node => {
  it.each(["stat", "lstat"] as const)("%s preserves character type and mode", async operation => {
    const bridge = await fixture(node);
    const metadata = await bridge[operation]("/character");
    expect(metadata.isCharacterDevice()).toBe(true);
    expect(metadata.mode).toBe(0o020666);
    expect(metadata.size).toBe(0);
    expect([metadata.atimeMs, metadata.mtimeMs, metadata.ctimeMs]).toEqual([1, 2, 3]);
    expect(metadata.isFile()).toBe(false);
    expect(metadata.isDirectory()).toBe(false);
    expect(metadata.isSymbolicLink()).toBe(false);
    expect(metadata.isBlockDevice()).toBe(false);
    expect(metadata.isFIFO()).toBe(false);
    expect(metadata.isSocket()).toBe(false);
  });

  it("follows device symlinks for stat, but preserves lstat and ordinary types", async () => {
    const bridge = await fixture(node);
    expect((await bridge.stat("/link")).isCharacterDevice()).toBe(true);
    const link = await bridge.lstat("/link");
    expect(link.isCharacterDevice()).toBe(false);
    expect(link.isSymbolicLink()).toBe(true);
    expect(link.mode & 0o170000).toBe(0o120000);
    for (const path of ["/regular", "/directory"]) {
      expect((await bridge.stat(path)).isCharacterDevice()).toBe(false);
    }
    await expect(bridge.stat("/absent")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([false, true])("readdir preserves character Dirents without descending into them (recursive=%s)", async recursive => {
    const bridge = await fixture(node);
    const entries = await bridge.readdir("/", { withFileTypes: true, recursive });
    const device = entries.find(entry => entry.name === "character");
    expect(device).toBeDefined();
    expect(device!.isCharacterDevice()).toBe(true);
    expect(device!.isFile()).toBe(false);
    expect(device!.isDirectory()).toBe(false);
    expect(device!.isSymbolicLink()).toBe(false);
    expect(device!.isBlockDevice()).toBe(false);
    expect(device!.isFIFO()).toBe(false);
    expect(device!.isSocket()).toBe(false);
    expect(device!.parentPath).toBe("/");
    expect(entries.filter(entry => entry.isCharacterDevice()).length).toBe(1);
    expect(entries.some(entry => entry.name === "note")).toBe(recursive);
    expect(entries.find(entry => entry.name === "link")!.isSymbolicLink()).toBe(true);
  });

  it("preserves character predicates on binary directory names", async () => {
    const bridge = await fixture(node);
    const entries = await bridge.readdir("/", { withFileTypes: true, encoding: "buffer" });
    const device = entries.find(entry => Buffer.from(entry.name).toString() === "character");
    expect(device).toBeDefined();
    expect(device!.isCharacterDevice()).toBe(true);
    expect(Array.from(device!.name)).toEqual(Array.from(new TextEncoder().encode("character")));
  });
});

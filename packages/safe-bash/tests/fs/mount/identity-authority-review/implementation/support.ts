import assert from "node:assert/strict";
import type { EntryComparison, FileStat, FileSystem, FsOptions } from "../../../../../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../../../../../src/fs/memory/index.js";

export const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
export const text = async (filesystem: FileSystem, path: string): Promise<string> => new TextDecoder().decode(await filesystem.readFile(path));

export function wrapped(filesystem: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(filesystem, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function opaque(filesystem: FileSystem, overrides: Partial<FileSystem> = {}): FileSystem {
  const strip = (stat: FileStat): FileStat => {
    const { identityScope: ignoredScope, dev: ignoredDevice, ino: ignoredInode, ...remaining } = stat;
    return remaining;
  };
  return wrapped(filesystem, {
    stat: async (path, options) => strip(await filesystem.stat(path, options)),
    lstat: async (path, options) => strip(await filesystem.lstat(path, options)),
    compareEntry: undefined,
    ...overrides,
  } as Partial<FileSystem>);
}

export async function comparison(filesystem: FileSystem, path: string, peer: FileSystem, peerPath: string, options?: FsOptions): Promise<EntryComparison> {
  assert.equal(typeof filesystem.compareEntry, "function", "NOT_IMPLEMENTED: approved public FileSystem.compareEntry");
  return filesystem.compareEntry!(path, peer, peerPath, options);
}

export async function seeded(): Promise<FileSystem> {
  const filesystem = createMemoryFileSystem();
  await filesystem.writeFile("/source", bytes("source sentinel"));
  await filesystem.writeFile("/target", bytes("target sentinel"));
  return filesystem;
}

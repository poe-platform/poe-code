import type { FsBridgeDirent, FsBridgeStats } from "./types.js";
import type { FileStat, FileType } from "../contracts/filesystem.js";

function predicates(type: FileType) {
  return {
    isFile: () => type === "file",
    isDirectory: () => type === "directory",
    isSymbolicLink: () => type === "symlink",
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}

export function bridgeStats(stat: FileStat): FsBridgeStats {
  return {
    dev: stat.dev ?? 0,
    ino: stat.ino ?? 0,
    mode: (stat.mode & 0o7777) | (stat.type === "directory" ? 0o040000 : stat.type === "symlink" ? 0o120000 : 0o100000),
    nlink: stat.nlink ?? 1,
    uid: stat.uid ?? 0,
    gid: stat.gid ?? 0,
    rdev: 0,
    size: stat.size,
    blksize: 4096,
    blocks: Math.ceil(stat.size / 512),
    atimeMs: stat.atimeMs,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    birthtimeMs: stat.birthtimeMs ?? stat.ctimeMs,
    atime: new Date(stat.atimeMs),
    mtime: new Date(stat.mtimeMs),
    ctime: new Date(stat.ctimeMs),
    birthtime: new Date(stat.birthtimeMs ?? stat.ctimeMs),
    ...predicates(stat.type),
  };
}

export function bridgeDirent<Name extends string | Uint8Array>(
  name: Name,
  parentPath: string,
  type: FileType,
): FsBridgeDirent<Name> {
  return { name, parentPath, path: parentPath, ...predicates(type) };
}

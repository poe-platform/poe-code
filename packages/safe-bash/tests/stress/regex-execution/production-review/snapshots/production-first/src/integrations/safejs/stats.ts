import type { Dirent, Stats } from "node:fs";
import type { FileStat, FileType } from "../../contracts/filesystem.js";

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

export function nodeStats(stat: FileStat): Stats {
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

export function nodeDirent<Name extends string | Buffer>(
  name: Name,
  parentPath: string,
  type: FileType,
): Dirent<Name> {
  return { name, parentPath, path: parentPath, ...predicates(type) };
}

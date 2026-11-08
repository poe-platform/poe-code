import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import type { FileStat, FileSystem, FsOptions } from "../contracts/filesystem.js";

function snapshot(stat: Stats): FileStat {
  return {
    type: stat.isDirectory()
      ? "directory"
      : stat.isSymbolicLink()
        ? "symlink"
        : stat.isFile()
          ? "file"
          : "character",
    size: stat.size,
    mode: stat.mode,
    mtimeMs: stat.mtimeMs,
    atimeMs: stat.atimeMs,
    ctimeMs: stat.ctimeMs,
    birthtimeMs: stat.birthtimeMs
  };
}

/** Trusted host access with native paths and symlink semantics; this is not a rooted sandbox. */
export function createHostFileSystem(): FileSystem {
  async function perform<T>(options: FsOptions | undefined, action: () => Promise<T>): Promise<T> {
    options?.signal?.throwIfAborted();
    const result = await action();
    options?.signal?.throwIfAborted();
    return result;
  }
  return {
    capabilities: {
      read: true,
      write: true,
      append: true,
      stat: true,
      readdir: true,
      mkdir: true,
      recursiveMkdir: true,
      rename: true,
      remove: true,
      removeDirectory: true,
      recursiveRemove: true,
      symlinks: true,
      hardlinks: true,
      permissions: true,
      timestamps: true,
      exclusiveCreate: true
    },
    readFile: (path, options) =>
      perform(options, () =>
        fs.readFile(path, options?.signal ? { signal: options.signal } : undefined)
      ),
    writeFile: (path, data, options) => perform(options, () => fs.writeFile(path, data, options)),
    appendFile: (path, data, options) => perform(options, () => fs.appendFile(path, data, options)),
    stat: (path, options) => perform(options, async () => snapshot(await fs.stat(path))),
    lstat: (path, options) => perform(options, async () => snapshot(await fs.lstat(path))),
    readdir: (path, options) =>
      perform(options, async () =>
        (await fs.readdir(path, { withFileTypes: true })).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory()
            ? "directory"
            : entry.isSymbolicLink()
              ? "symlink"
              : entry.isFile()
                ? "file"
                : "character"
        }))
      ),
    mkdir: (path, options) =>
      perform(options, async () => {
        await fs.mkdir(path, options);
      }),
    rm: (path, options) => perform(options, () => fs.rm(path, options)),
    unlink: (path, options) => perform(options, () => fs.unlink(path)),
    rmdir: (path, options) => perform(options, () => fs.rmdir(path)),
    rename: (source, destination, options) =>
      perform(options, () => fs.rename(source, destination)),
    copyFile: (source, destination, options) =>
      perform(options, () =>
        fs.copyFile(source, destination, options?.exclusive ? fs.constants.COPYFILE_EXCL : 0)
      ),
    realpath: (path, options) => perform(options, () => fs.realpath(path)),
    access: (path, mode, options) => perform(options, () => fs.access(path, mode)),
    readlink: (path, options) => perform(options, () => fs.readlink(path)),
    symlink: (target, path, options) => perform(options, () => fs.symlink(target, path)),
    link: (source, destination, options) => perform(options, () => fs.link(source, destination)),
    chmod: (path, mode, options) => perform(options, () => fs.chmod(path, mode)),
    utimes: (path, atimeMs, mtimeMs, options) =>
      perform(options, () => fs.utimes(path, atimeMs / 1000, mtimeMs / 1000)),
    truncate: (path, length, options) => perform(options, () => fs.truncate(path, length))
  };
}

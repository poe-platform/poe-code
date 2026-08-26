import assert from "node:assert/strict";
import type {
  DirectoryEntry, FileStat, FileSystem, FileSystemCapabilities, FsOptions,
} from "../../../src/contracts/index.js";

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export function createFixture(optional = true, capabilities: FileSystemCapabilities = {
  readOnly: false, symlinks: true, hardlinks: true, permissions: true,
  timestamps: true, atomicRename: true, streamingRead: true, streamingWrite: true,
}) {
  const calls: RecordedCall[] = [];
  const state = {
    bytes: Buffer.from([0, 255, 42, 128]),
    stat: { type: "file", size: 4, mode: 0o100777, mtimeMs: 2, atimeMs: 3, ctimeMs: 4 } as FileStat,
    lstat: { type: "symlink", size: 4, mode: 0o120777, mtimeMs: 5, atimeMs: 6, ctimeMs: 7 } as FileStat,
    entries: [{ name: "file", type: "file" }, { name: "link", type: "symlink" }] as DirectoryEntry[],
    failure: undefined as unknown,
    streamClosed: 0,
  };
  function record(receiver: FileSystem, method: string, args: unknown[], options?: FsOptions): void {
    assert.equal(receiver, filesystem, "delegate methods must retain their receiver");
    calls.push({ method, args });
    if (state.failure !== undefined) throw state.failure;
    options?.signal?.throwIfAborted();
  }
  function unexpected(method: string): never {
    calls.push({ method, args: [] });
    throw new Error(`Delegate mutation reached: ${method}`);
  }
  const filesystem: FileSystem = {
    capabilities,
    async readFile(path, options) {
      record(this, "readFile", [path, options], options);
      return state.bytes;
    },
    async stat(path, options) {
      record(this, "stat", [path, options], options);
      return state.stat;
    },
    async lstat(path, options) {
      record(this, "lstat", [path, options], options);
      return state.lstat;
    },
    async readdir(path, options) {
      record(this, "readdir", [path, options], options);
      return state.entries;
    },
    async realpath(path, options) {
      record(this, "realpath", [path, options], options);
      return "/resolved/file";
    },
    async access(path, mode, options) {
      record(this, "access", [path, mode, options], options);
    },
    async writeFile() { unexpected("writeFile"); },
    async appendFile() { unexpected("appendFile"); },
    async mkdir() { unexpected("mkdir"); },
    async rm() { unexpected("rm"); },
    async rename() { unexpected("rename"); },
    async copyFile() { unexpected("copyFile"); },
  };
  if (optional) {
    filesystem.readlink = async function (path, options) {
      record(this, "readlink", [path, options], options);
      return "../file";
    };
    filesystem.readStream = async function* (path, options) {
      record(this, "readStream", [path, options], options);
      try {
        yield state.bytes;
        options?.signal?.throwIfAborted();
        yield state.bytes;
      } finally {
        state.streamClosed++;
      }
    };
    filesystem.symlink = async () => { unexpected("symlink"); };
    filesystem.link = async () => { unexpected("link"); };
    filesystem.chmod = async () => { unexpected("chmod"); };
    filesystem.utimes = async () => { unexpected("utimes"); };
    filesystem.truncate = async () => { unexpected("truncate"); };
    filesystem.writeStream = async () => { unexpected("writeStream"); };
  }
  return { filesystem, calls, state };
}

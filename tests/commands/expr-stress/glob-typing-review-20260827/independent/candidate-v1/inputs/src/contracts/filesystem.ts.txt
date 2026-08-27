import type { ByteSource } from "./io.js";

export type FileType = "file" | "directory" | "symlink";
export type EntryComparison = "same" | "distinct" | "unknown";

export interface FileStat {
  readonly type: FileType;
  readonly size: number;
  readonly allocatedBytes?: number;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly atimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs?: number;
  readonly identityScope?: object | symbol;
  readonly ino?: number;
  readonly dev?: number;
  readonly nlink?: number;
  readonly uid?: number;
  readonly gid?: number;
}

export interface DirectoryEntry {
  readonly name: string;
  readonly type: FileType;
}

export interface FileSystemCapabilities {
  readonly readOnly?: boolean;
  readonly symlinks?: boolean;
  readonly hardlinks?: boolean;
  readonly permissions?: boolean;
  readonly timestamps?: boolean;
  readonly atomicRename?: boolean;
  readonly snapshotRmdir?: boolean;
  readonly streamingRead?: boolean;
  readonly streamingWrite?: boolean;
  readonly [capability: string]: boolean | undefined;
}

export interface FsOptions {
  readonly signal?: AbortSignal;
}

export interface ReadFileOptions extends FsOptions {
  readonly maxBytes?: number;
}

export interface WriteFileOptions extends FsOptions {
  readonly flag?: "w" | "wx" | "a" | "ax";
  readonly mode?: number;
}

export interface AppendFileOptions extends FsOptions {
  readonly mode?: number;
}

export interface MkdirOptions extends FsOptions {
  readonly recursive?: boolean;
  readonly mode?: number;
}

export interface RemoveOptions extends FsOptions {
  readonly recursive?: boolean;
  readonly force?: boolean;
}

export interface CopyFileOptions extends FsOptions {
  readonly exclusive?: boolean;
}

export interface ReadStreamOptions extends FsOptions {
  readonly start?: number;
  readonly endExclusive?: number;
  readonly chunkSize?: number;
}

export interface FileSystem {
  readonly capabilities: FileSystemCapabilities;
  readFile(path: string, options?: ReadFileOptions): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, options?: WriteFileOptions): Promise<void>;
  appendFile(path: string, data: Uint8Array, options?: AppendFileOptions): Promise<void>;
  stat(path: string, options?: FsOptions): Promise<FileStat>;
  lstat(path: string, options?: FsOptions): Promise<FileStat>;
  compareEntry?(path: string, peer: FileSystem, peerPath: string, options?: FsOptions): Promise<EntryComparison>;
  readdir(path: string, options?: FsOptions): Promise<DirectoryEntry[]>;
  mkdir(path: string, options?: MkdirOptions): Promise<void>;
  rm(path: string, options?: RemoveOptions): Promise<void>;
  rmdir?(path: string, options?: FsOptions): Promise<void>;
  rename(source: string, destination: string, options?: FsOptions): Promise<void>;
  copyFile(source: string, destination: string, options?: CopyFileOptions): Promise<void>;
  realpath(path: string, options?: FsOptions): Promise<string>;
  access(path: string, mode?: number, options?: FsOptions): Promise<void>;
  readlink?(path: string, options?: FsOptions): Promise<string>;
  symlink?(target: string, path: string, options?: FsOptions): Promise<void>;
  link?(existingPath: string, newPath: string, options?: FsOptions): Promise<void>;
  chmod?(path: string, mode: number, options?: FsOptions): Promise<void>;
  utimes?(path: string, atimeMs: number, mtimeMs: number, options?: FsOptions): Promise<void>;
  truncate?(path: string, length?: number, options?: FsOptions): Promise<void>;
  readStream?(path: string, options?: ReadStreamOptions): ByteSource;
  writeStream?(path: string, source: ByteSource, options?: WriteFileOptions): Promise<void>;
}

export type FileSystemFactory = (
  options: Readonly<Record<string, unknown>>,
) => FileSystem | Promise<FileSystem>;

export const ACCESS_MODES = Object.freeze({ F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 });

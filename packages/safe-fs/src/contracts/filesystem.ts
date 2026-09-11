import type { ByteSource } from "./io.js";

export type FileType = "file" | "directory" | "symlink" | "character";
export type EntryComparison = "same" | "distinct" | "unknown";

export interface FileStat {
  readonly type: FileType;
  readonly size: number;
  readonly allocatedBytes?: number;
  readonly preferredIoBlockSize?: number;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly atimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs?: number;
  readonly revision?: number;
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
  readonly read?: boolean;
  readonly stat?: boolean;
  readonly readdir?: boolean;
  readonly realpath?: boolean;
  readonly access?: boolean;
  readonly write?: boolean;
  readonly append?: boolean;
  readonly exclusiveCreate?: boolean;
  readonly explicitDirectories?: boolean;
  readonly implicitDirectories?: boolean;
  readonly mkdir?: boolean;
  readonly recursiveMkdir?: boolean;
  readonly remove?: boolean;
  readonly removeDirectory?: boolean;
  readonly recursiveRemove?: boolean;
  readonly rename?: boolean;
  readonly copy?: boolean;
  readonly exclusiveCopy?: boolean;
  readonly readlink?: boolean;
  readonly truncate?: boolean;
  readonly streamingAppend?: boolean;
  readonly randomAccessWrite?: boolean;
  readonly symlinks?: boolean;
  readonly hardlinks?: boolean;
  readonly permissions?: boolean;
  readonly timestamps?: boolean;
  readonly atomicRename?: boolean;
  readonly atomicFileStaging?: boolean;
  readonly atomicFileMutation?: boolean;
  readonly atomicDirectoryMetadata?: boolean;
  readonly atomicRenameNoReplace?: boolean;
  readonly snapshotRmdir?: boolean;
  readonly streamingRead?: boolean;
  readonly retainedRead?: boolean;
  readonly retainedResize?: boolean;
  readonly atomicResize?: boolean;
  readonly streamingWrite?: boolean;
  readonly descriptorWriteStream?: boolean;
  readonly [capability: string]: boolean | undefined;
}

export interface FsOptions {
  readonly signal?: AbortSignal;
}

export interface OpenReadFileOptions extends FsOptions {
  readonly allowDirectory?: boolean;
}

export interface CapabilityQueryOptions extends OpenReadFileOptions {
  readonly create?: boolean;
}

export interface FileReadHandle {
  stat(options?: FsOptions): Promise<FileStat>;
  read(position: number, maxBytes: number, options?: FsOptions): Promise<Uint8Array>;
  seekEnd?: ((options?: FsOptions) => Promise<bigint>) | undefined;
  close(): Promise<void>;
}

export interface OpenResizeFileOptions extends FsOptions {
  readonly create?: boolean;
  readonly mode?: number;
}

/** A single atomic read/compute/resize operation, never a caller-side stat/write pair.
 * size and referenceSize use signed 64-bit byte integers (referenceSize is nonnegative).
 * ioBlocks scales size by the target's preferred I/O block size before applying the
 * modifier. Relative/min/max/round operations use referenceSize or the current size.
 * Signed overflow rejects; negative final sizes clamp to zero. Providers enforce
 * their size/quota/permission limits before allocation or publication. */
export interface FileResizeOperation {
  readonly size: bigint;
  readonly modifier: "absolute" | "relative" | "minimum" | "maximum" | "down" | "up";
  readonly referenceSize?: bigint;
  readonly ioBlocks?: boolean;
}

export interface FileResizeOptions extends FsOptions {
  readonly create?: boolean;
  readonly mode?: number;
}

export interface FileResizeHandle {
  stat(options?: FsOptions): Promise<FileStat>;
  truncate(length: number, options?: FsOptions): Promise<void>;
  seekEnd?: ((options?: FsOptions) => Promise<bigint>) | undefined;
  close(): Promise<void>;
}

export interface RenameOptions extends FsOptions {
  readonly noReplace?: boolean;
}

export interface ReadFileOptions extends FsOptions {
  readonly maxBytes?: number;
}

export interface ReadDirectoryOptions extends FsOptions {
  /**
   * Optional per-listing entry admission limit, a nonnegative safe integer.
   * Zero permits an empty listing; overflow rejects with EFBIG, never truncates.
   * Omission preserves the adapter's existing limits and ordering. Composed
   * adapters may conservatively count distinct candidates before visibility
   * filtering. This is not a global traversal, host-allocation or work quota.
   */
  readonly maxEntries?: number;
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

export interface ConditionalWriteFileOptions extends FsOptions {
  readonly parent: FileStat;
  readonly expected: FileStat | null;
  readonly append?: boolean;
  readonly mode?: number;
}

export interface ConditionalRemoveFileOptions extends FsOptions {
  readonly parent: FileStat;
  readonly expected: FileStat;
}

export interface FileStagingEntry {
  readonly path: string;
  readonly stat: FileStat;
}

export interface FileStaging {
  readonly parent: FileStagingEntry;
  readonly directory: FileStagingEntry;
  readonly file: FileStagingEntry;
}

export type StagedFileContent =
  | { readonly type: "file"; readonly data: Uint8Array }
  | { readonly type: "symlink"; readonly target: string };

export interface CreateStagedFileOptions extends FsOptions {
  readonly parent: FileStat;
  readonly mode?: number;
  readonly atimeMs?: number;
  readonly mtimeMs?: number;
}

export interface PublishStagedFileOptions extends FsOptions {
  readonly parent: FileStat;
  readonly destination: FileStat | null;
}

export interface PrepareDirectoryOptions extends FsOptions {
  readonly expected: FileStat | null;
  readonly parent: FileStat;
  readonly mode?: number;
  readonly atimeMs?: number;
  readonly mtimeMs?: number;
}

export interface FileSystem {
  writeFileConditional?(path: string, data: Uint8Array, options: ConditionalWriteFileOptions): Promise<FileStat>;
  removeFileConditional?(path: string, options: ConditionalRemoveFileOptions): Promise<void>;
  readonly capabilities: FileSystemCapabilities;
  prepareDirectory?(path: string, options: PrepareDirectoryOptions): Promise<FileStat>;
  createStagedFile?(directoryPath: string, name: string, content: StagedFileContent, options: CreateStagedFileOptions): Promise<FileStaging>;
  publishStagedFile?(staging: FileStaging, destination: string, options: PublishStagedFileOptions): Promise<void>;
  removeStagedFile?(staging: FileStaging, options?: FsOptions): Promise<void>;
  openReadFile?(path: string, options?: OpenReadFileOptions): Promise<FileReadHandle>;
  openResizeFile?(path: string, options?: OpenResizeFileOptions): Promise<FileResizeHandle>;
  /** Missing targets reject ENOENT unless create is true; existing bytes survive refusals. */
  resizeFile?(path: string, operation: FileResizeOperation, options?: FileResizeOptions): Promise<void>;
  canonicalizeMissingTarget?(path: string, options?: FsOptions): string | undefined;
  capabilitiesFor?(path: string, options?: CapabilityQueryOptions): Promise<FileSystemCapabilities>;
  readFile(path: string, options?: ReadFileOptions): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, options?: WriteFileOptions): Promise<void>;
  appendFile(path: string, data: Uint8Array, options?: AppendFileOptions): Promise<void>;
  stat(path: string, options?: FsOptions): Promise<FileStat>;
  lstat(path: string, options?: FsOptions): Promise<FileStat>;
  compareEntry?(path: string, peer: FileSystem, peerPath: string, options?: FsOptions): Promise<EntryComparison>;
  readdir(path: string, options?: ReadDirectoryOptions): Promise<DirectoryEntry[]>;
  mkdir(path: string, options?: MkdirOptions): Promise<void>;
  rm(path: string, options?: RemoveOptions): Promise<void>;
  rmdir?(path: string, options?: FsOptions): Promise<void>;
  rename(source: string, destination: string, options?: RenameOptions): Promise<void>;
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

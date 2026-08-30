import type { FileSystem, FsOptions } from "../contracts/filesystem.js";

export interface FsBridgeCodec {
  isEncoding(encoding: string): boolean;
  encode(text: string, encoding: string): Uint8Array;
  decode(bytes: Uint8Array, encoding: string): string;
}

export interface FsBridgeOptions {
  readonly codec: FsBridgeCodec;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
}

export interface FsBridgeFileSystem extends FileSystem {
  rmdir?(path: string, options?: FsOptions): Promise<void>;
}

export type FsBridgeEncoding = "ascii" | "utf8" | "utf-8" | "utf16le" | "utf-16le"
  | "ucs2" | "ucs-2" | "base64" | "base64url" | "latin1" | "binary" | "hex";

export interface ObjectEncodingOptions {
  encoding?: FsBridgeEncoding | null | undefined;
}

export type BufferEncodingOption = "buffer" | { encoding: "buffer" };
export type Mode = number | string;
export interface MakeDirectoryOptions {
  recursive?: boolean | undefined;
  mode?: Mode | undefined;
}
export interface StatOptions {
  bigint?: boolean | undefined;
}

export interface FsBridgePredicates {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
}

export interface FsBridgeStats extends FsBridgePredicates {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  size: number;
  blksize: number;
  blocks: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
}

export interface FsBridgeDirent<Name extends string | Uint8Array = string> extends FsBridgePredicates {
  name: Name;
  parentPath: string;
  path: string;
}

export interface BridgePrimitives<Binary extends Uint8Array> {
  readonly codec: FsBridgeCodec;
  copyBytes(bytes: Uint8Array): Binary;
  pathValue?(value: unknown): unknown;
  randomSuffix(): string;
  readonly paths: {
    isAbsolute(path: string): boolean;
    dirname(path: string): string;
    relative(from: string, to: string): string;
    resolve(cwd: string, ...paths: string[]): string;
  };
}

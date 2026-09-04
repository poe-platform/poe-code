import type { FileStat, FsOptions } from "./filesystem.js";

export interface OpenFileOptions extends FsOptions {
  readonly access: "read" | "write" | "readwrite";
  readonly creation?: "never" | "ifMissing" | "exclusive";
  readonly truncate?: boolean;
  readonly append?: boolean;
  readonly mode?: number;
  readonly synchronization?: "data" | "all";
}

export interface FileDescriptorCapabilities {
  readonly positionedRead: boolean;
  readonly positionedWrite: boolean;
  readonly truncate: boolean;
  readonly synchronization: "none" | "volatile" | "storage";
}

export interface FileDescriptor {
  readonly capabilities: FileDescriptorCapabilities;
  stat(options?: FsOptions): Promise<FileStat>;
  read(buffer: Uint8Array, position: number | null, options?: FsOptions): Promise<number>;
  write(buffer: Uint8Array, position: number | null, options?: FsOptions): Promise<number>;
  truncate(length: number, options?: FsOptions): Promise<void>;
  sync(dataOnly: boolean, options?: FsOptions): Promise<void>;
  close(): Promise<void>;
}

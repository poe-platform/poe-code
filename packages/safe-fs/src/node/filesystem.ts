import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import type * as FsPromises from "node:fs/promises";
import type { FileSystem, FsOptions } from "../contracts/filesystem.js";
import { FileSystemBridge } from "../bridge/filesystem.js";

export type NodeFsImplementation = Pick<typeof FsPromises,
  | "access" | "appendFile" | "chmod" | "copyFile" | "cp" | "link" | "lstat"
  | "mkdir" | "mkdtemp" | "readFile" | "readdir" | "readlink" | "realpath"
  | "rename" | "rm" | "rmdir" | "stat" | "symlink" | "truncate" | "utimes" | "writeFile"
>;

export interface NodeFsBridgeOptions {
  readonly cwd?: string;
  readonly signal?: AbortSignal;
}

export interface NodeFsBridgeFileSystem extends FileSystem {
  rmdir?(path: string, options?: FsOptions): Promise<void>;
}

export function createNodeFsBridge(fs: FileSystem, options: NodeFsBridgeOptions = {}): NodeFsImplementation {
  return new FileSystemBridge<Buffer<ArrayBuffer>>(fs, options, {
    codec: {
      isEncoding: Buffer.isEncoding,
      encode(text, encoding) {
        if (!Buffer.isEncoding(encoding)) throw new TypeError("Invalid encoding");
        return Buffer.from(text, encoding);
      },
      decode(bytes, encoding) {
        if (!Buffer.isEncoding(encoding)) throw new TypeError("Invalid encoding");
        return Buffer.from(bytes).toString(encoding);
      }
    },
    copyBytes: Buffer.from,
    pathValue(value) {
      return value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString("utf8") : value;
    },
    randomSuffix() { return randomBytes(6).toString("hex").slice(0, 6); },
    paths: posix
  });
}

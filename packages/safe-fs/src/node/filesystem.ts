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
  | "unlink" | "rename" | "rm" | "rmdir" | "stat" | "symlink" | "truncate" | "utimes" | "writeFile"
>;

export interface NodeFsBridgeOptions {
  readonly cwd?: string;
  /** Optional confinement boundary; defaults to cwd. */
  readonly root?: string;
  readonly signal?: AbortSignal;
  /** Trusted per-read backend byte cap, enforced before copying or decoding. */
  readonly readFileMaxBytes?: number;
  /** Reserve host resources; release after decoding and actual backend settlement, including cancellation. */
  readonly reserveReadFile?: () => () => void;
}

export interface NodeFsBridgeFileSystem extends FileSystem {
  rmdir?(path: string, options?: FsOptions): Promise<void>;
}

const providers = new WeakMap<object, FileSystem>();
export function getNodeFsBridgeProvider(bridge: object): FileSystem | undefined {
  return providers.get(bridge);
}

export function createNodeFsBridge(fs: FileSystem, options: NodeFsBridgeOptions = {}): NodeFsImplementation {
  const bridge = new FileSystemBridge<Buffer<ArrayBuffer>>(fs, options, {
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
  providers.set(bridge, fs);
  return bridge;
}

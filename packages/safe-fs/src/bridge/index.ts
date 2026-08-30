import { platform } from "#safe-fs-platform";
import type { FileSystem } from "../contracts/filesystem.js";
import { dirname, relativePath, resolvePath } from "../contracts/virtual-path.js";
import { FileSystemBridge } from "./filesystem.js";
import type { FsBridgeOptions } from "./types.js";

export type {
  FsBridgeCodec, FsBridgeDirent, FsBridgeEncoding, FsBridgeFileSystem, FsBridgeOptions, FsBridgeStats
} from "./types.js";
export type FsBridge = FileSystemBridge<Uint8Array<ArrayBuffer>>;

export function createFsBridge(fs: FileSystem, options: FsBridgeOptions): FsBridge {
  if (options === undefined || options === null) throw new TypeError("An explicit filesystem codec is required");
  return new FileSystemBridge(fs, options, {
    codec: options.codec,
    copyBytes(bytes) { return new Uint8Array(bytes); },
    randomSuffix() { return platform.randomUUID().slice(0, 6); },
    paths: {
      isAbsolute(path) { return typeof path === "string" && path.startsWith("/"); },
      dirname,
      relative: relativePath,
      resolve: resolvePath
    }
  });
}

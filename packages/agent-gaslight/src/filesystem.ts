import { createFsBridge } from "@poe-code/safe-fs/bridge";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { createDefaultFileSystem, hostCwd } from "#gaslight-platform";
import type { GaslightFileSystem, GaslightArchiveFileSystem } from "./types.js";

type GaslightStorage = GaslightArchiveFileSystem & { unlink?(path: string): Promise<void>; realpath?(path: string): Promise<string> };
export function gaslightFileSystem(fs: GaslightFileSystem | FileSystem = createDefaultFileSystem()): GaslightStorage {
  if (!("capabilities" in fs)) return fs;
  const bridge = createFsBridge(fs, { cwd: hostCwd(), root: "/", codec: {
    isEncoding: encoding => encoding === "utf8" || encoding === "utf-8",
    encode: text => new TextEncoder().encode(text),
    decode: bytes => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
  } });
  return {
    realpath: bridge.realpath.bind(bridge), readFile: (path, encoding) => bridge.readFile(path, encoding),
    writeFile: bridge.writeFile.bind(bridge), readdir: path => bridge.readdir(path),
    stat: path => bridge.stat(path), lstat: path => bridge.lstat(path),
    mkdir: bridge.mkdir.bind(bridge), rmdir: bridge.rmdir.bind(bridge),
    rename: bridge.rename.bind(bridge), unlink: bridge.unlink.bind(bridge)
  };
}

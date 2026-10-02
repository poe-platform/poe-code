import { createFsBridge } from "@poe-code/safe-fs/bridge";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { createDefaultFileSystem, hostCwd } from "#experiment-platform";
import type { ExperimentFileSystem } from "./types.js";

export function experimentFileSystem(fs: ExperimentFileSystem | FileSystem = createDefaultFileSystem()): ExperimentFileSystem {
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
    async mkdir(path, options) { await bridge.mkdir(path, options); },
    rmdir: bridge.rmdir.bind(bridge), appendFile: bridge.appendFile.bind(bridge),
    rename: bridge.rename.bind(bridge), unlink: bridge.unlink.bind(bridge)
  };
}

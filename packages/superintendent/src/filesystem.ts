import { createFsBridge } from "@poe-code/safe-fs/bridge";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { createDefaultFileSystem } from "#superintendent-filesystem";
import type { SuperintendentFileSystem } from "./runtime/loop.js";

export function superintendentFileSystem(fs: SuperintendentFileSystem | FileSystem = createDefaultFileSystem()): SuperintendentFileSystem {
  if (!("capabilities" in fs)) return fs;
  const bridge = superintendentOperations(fs);
  return {
    realpath: bridge.realpath.bind(bridge),
    readFile: (path, encoding) => bridge.readFile(path, encoding),
    writeFile: bridge.writeFile.bind(bridge),
    readdir: path => bridge.readdir(path),
    lstat: path => bridge.lstat(path),
    stat: path => bridge.stat(path),
    async mkdir(path, options) { await bridge.mkdir(path, options); },
    rmdir: bridge.rmdir.bind(bridge),
    unlink: bridge.unlink.bind(bridge),
    rename: bridge.rename.bind(bridge)
  };
}

export function superintendentOperations(fs: FileSystem) {
  return createFsBridge(fs, { cwd: "/", root: "/", codec: {
    isEncoding: encoding => encoding === "utf8" || encoding === "utf-8",
    encode: text => new TextEncoder().encode(text),
    decode: bytes => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
  } });
}

export interface SuperintendentCommandRuntime {
  fs: FileSystem;
  cwd: string;
  homeDir: string;
  env?: Record<string, string | undefined>;
}

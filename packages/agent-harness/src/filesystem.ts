import { createFsBridge } from "@poe-code/safe-fs/bridge";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { createDefaultFileSystem, cwd } from "#harness-platform";

export function harnessFileSystem(fs: FileSystem = createDefaultFileSystem()) {
  return createFsBridge(fs, { cwd: cwd(), root: "/", codec: {
    isEncoding: encoding => encoding === "utf8" || encoding === "utf-8",
    encode: text => new TextEncoder().encode(text),
    decode: bytes => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
  } });
}
export type HarnessFileSystem = ReturnType<typeof harnessFileSystem>;

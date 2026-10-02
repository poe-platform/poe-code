import { createFsBridge } from "@poe-code/safe-fs/bridge";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import type { spawn } from "@poe-code/agent-spawn";
import { createDefaultFileSystem } from "#memory-platform";

export interface MemoryRuntime {
  fs?: FileSystem;
  signal?: AbortSignal;
  spawn?: (...args: Parameters<typeof spawn>) => ReturnType<typeof spawn>;
  countTokens?: (text: string) => number;
}

export function memoryFileSystem(runtime: MemoryRuntime) {
  return createFsBridge(runtime.fs ?? createDefaultFileSystem(), { cwd: "/", root: "/", signal: runtime.signal, codec: {
    isEncoding: encoding => encoding === "utf8" || encoding === "utf-8",
    encode: text => new TextEncoder().encode(text),
    decode: bytes => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
  } });
}

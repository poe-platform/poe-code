import { createFsBridge } from "@poe-code/safe-fs/bridge";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { defaultFileSystem } from "#hook-platform";
export interface HookRuntimeOptions { fs: FileSystem; signal?: AbortSignal }
export function defaultHookRuntime(): HookRuntimeOptions { return { fs: defaultFileSystem() }; }
export function hookOperations(options: HookRuntimeOptions) {
  return Object.assign(createFsBridge(options.fs, {
    cwd: "/", root: "/", signal: options.signal, codec: {
      isEncoding: encoding => encoding === "utf8" || encoding === "utf-8",
      encode: text => new TextEncoder().encode(text),
      decode: bytes => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
    }
  }), { provider: options.fs });
}
export type HookOperations = ReturnType<typeof hookOperations>;
const pending = new WeakMap<FileSystem, Promise<unknown>>();
export async function exclusiveHooks<T>(runtime: HookRuntimeOptions, action: () => Promise<T>): Promise<T> {
  const result = (pending.get(runtime.fs) ?? Promise.resolve()).then(action);
  pending.set(runtime.fs, result.catch(() => undefined));
  return result;
}


import { StackContext } from "./context.js";
// Hosts may supply native asynchronous context without Node module resolution.
export const AsyncLocalStorage: typeof StackContext = Reflect.get(globalThis, "AsyncLocalStorage") ?? StackContext;
export { types } from "./types.js";
import { SandboxError } from "../interp/budget.js";
import type { HostCallbackContext } from "../interp/host-callback-context.js";

export const cloneSharedBufferWrapper: (value: SharedArrayBuffer) => SharedArrayBuffer = structuredClone;

export function createHostCallbackContext(): HostCallbackContext {
  let storage: StackContext<boolean> | undefined = new AsyncLocalStorage<boolean>();
  return {
    run(value, callback) {
      if (storage === undefined) throw new SandboxError("reentry");
      return storage.run(value, callback);
    },
    getStore() {
      return storage?.getStore();
    },
    disable() {
      // Workerd has no native disable. Retire access even in retained async contexts.
      storage = undefined;
    }
  };
}

export const accessDeniedSystemError: readonly [number, string] = [-13, "permission denied"];

export const yieldToHost = () => new Promise<void>(resolve => setTimeout(resolve, 0));
export const hostCwd = () => "/";
export const hostPlatform = "workerd";

export const fsConstants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 };
export const hostFs = new Proxy({} as import("@poe-code/safe-fs/core").FsBridge, {
  get() { throw new TypeError("A filesystem adapter is required on this host."); }
});
// Diagnostics use data descriptors and never invoke a caller's toString.
export function inspect(value: unknown, _options?: { depth?: number }): string {
  if (typeof value === "string") return "'" + value.replaceAll("'", "\\'") + "'";
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[Array]" : "[Object]";
  return String(value);
}

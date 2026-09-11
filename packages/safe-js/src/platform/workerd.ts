import { constants } from "node:os";
import { AsyncLocalStorage } from "node:async_hooks";
import { SandboxError } from "../interp/budget.js";
import type { HostCallbackContext } from "../interp/host-callback-context.js";

export function createHostCallbackContext(): HostCallbackContext {
  let storage: AsyncLocalStorage<boolean> | undefined = new AsyncLocalStorage<boolean>();
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

export const accessDeniedSystemError: readonly [number, string] = [-Math.abs(constants.errno.EACCES!), "permission denied"];

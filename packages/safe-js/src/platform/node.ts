import * as nodeUtil from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import type { HostCallbackContext } from "../interp/host-callback-context.js";

export function createHostCallbackContext(): HostCallbackContext {
  return new AsyncLocalStorage<boolean>();
}

export const accessDeniedSystemError: readonly [number, string] = readSystemError("EACCES");

function readSystemError(code: string): [number, string] {
  const fallback = new Map<number, [string, string]>([
    [process.platform === "win32" ? -4092 : -13, ["EACCES", "permission denied"]]
  ]);
  const systemErrors = nodeUtil.getSystemErrorMap?.() ?? fallback;
  for (const [errno, [name, message]] of systemErrors) {
    if (name === code) {
      return [errno, message];
    }
  }

  throw new Error(`node does not define the ${code} system error.`);
}

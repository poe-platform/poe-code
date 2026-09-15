import * as nodeUtil from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import { MessageChannel, MessagePort, receiveMessageOnPort } from "node:worker_threads";
import type { HostCallbackContext } from "../interp/host-callback-context.js";

const nativeClone = structuredClone;
const sharedByteLength = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")!.get!;
const postMessage = MessagePort.prototype.postMessage;
const closePort = MessagePort.prototype.close;

// Probe private storage once: a broken native clone must never copy a guest's
// potentially large allocation before selecting the shared-wrapper fallback.
const probe = new SharedArrayBuffer(1);
let nativeSharesStorage = false;
try {
  const copy = nativeClone(probe);
  Reflect.apply(sharedByteLength, copy, []);
  new Uint8Array(copy)[0] = 1;
  nativeSharesStorage = copy !== probe && new Uint8Array(probe)[0] === 1;
} catch {
  // Some supported hosts do not implement shared-buffer structured cloning.
}

export const cloneSharedBufferWrapper: (value: SharedArrayBuffer) => SharedArrayBuffer = nativeSharesStorage
  ? nativeClone
  : (value) => {
    Reflect.apply(sharedByteLength, value, []);
    const { port1, port2 } = new MessageChannel();
    try {
      Reflect.apply(postMessage, port1, [value]);
      const copy: unknown = receiveMessageOnPort(port2)?.message;
      Reflect.apply(sharedByteLength, copy, []);
      if (copy === value) throw new TypeError("Shared storage requires a distinct wrapper.");
      return copy as SharedArrayBuffer;
    } finally {
      Reflect.apply(closePort, port1, []);
      Reflect.apply(closePort, port2, []);
    }
  };

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

import type { FileSystem } from "../contracts/index.js";

/** Creation mask carried through the shell's transparent filesystem views. */
export const creationUmask = Symbol("creationUmask");

const runtimeBackingFileSystems = new WeakMap<FileSystem, FileSystem>();

export function registerRuntimeBackingFileSystem(wrapper: FileSystem, backing: FileSystem): void {
  runtimeBackingFileSystems.set(wrapper, backing);
}

export function getRuntimeBackingFileSystem(fs: FileSystem): FileSystem | undefined {
  return runtimeBackingFileSystems.get(fs);
}

const syncResolved = Symbol.for("safe-bash.syncResolved");
const resolvedVoid: Promise<void> = Object.defineProperty(Promise.resolve(), syncResolved, { value: true });

export function isSyncResolved(promise: unknown): promise is Promise<never> {
  return promise === resolvedVoid || Boolean(promise && typeof promise === "object" && (promise as Record<symbol, unknown>)[syncResolved]);
}

const signalAbortWaiters = new WeakMap<AbortSignal, Set<(reason: unknown) => void>>();

export function addAbortSignalWaiter(signal: AbortSignal, waiter: (reason: unknown) => void): Set<(reason: unknown) => void> {
  let waiters = signalAbortWaiters.get(signal);
  if (!waiters) {
    waiters = new Set();
    signalAbortWaiters.set(signal, waiters);
    const set = waiters;
    signal.addEventListener("abort", () => {
      const reason = signal.reason;
      const pending = [...set];
      set.clear();
      for (let i = 0; i < pending.length; i++) pending[i]!(reason);
    }, { once: true });
  }
  waiters.add(waiter);
  return waiters;
}

function interruptibleSlow<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    const waiters = addAbortSignalWaiter(signal, reject);
    promise.then(
      value => { waiters.delete(reject); resolve(value); },
      error => { waiters.delete(reject); reject(error); },
    );
  });
}

export function interruptible<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  if (isSyncResolved(promise)) return promise;
  return interruptibleSlow(promise, signal);
}

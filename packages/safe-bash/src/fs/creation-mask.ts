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

const managedSignalSymbol = Symbol.for("safe-bash.managedSignal");
const managedControlSignalSymbol = Symbol.for("safe-bash.managedControlSignal");
const managedWaitersSymbol = Symbol.for("safe-bash.managedWaiters");

export interface ManagedControlController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}

class ManagedControlSignalImpl {
  readonly [managedSignalSymbol] = true;
  readonly [managedControlSignalSymbol] = true;
  aborted = false;
  reason: unknown = undefined;
  throwIfAborted(): void {
    if (this.aborted) throw this.reason;
  }
}

export function createManagedControlController(): ManagedControlController {
  const signal = new ManagedControlSignalImpl();
  return {
    signal: signal as unknown as AbortSignal,
    abort(reason?: unknown): void {
      if (signal.aborted) return;
      signal.aborted = true;
      signal.reason = reason !== undefined ? reason : new DOMException("This operation was aborted", "AbortError");
      notifyAbortSignalWaiters(signal as unknown as AbortSignal, signal.reason);
    },
  };
}

export function isManagedControlSignal(value: unknown): value is AbortSignal {
  return Boolean(value && typeof value === "object" && (value as Record<symbol, unknown>)[managedControlSignalSymbol]);
}

export function registerManagedAbortSignal(signal: AbortSignal): AbortSignal {
  (signal as unknown as Record<symbol, unknown>)[managedSignalSymbol] = true;
  return signal;
}

export function isManagedAbortSignal(signal: AbortSignal): boolean {
  return Boolean((signal as unknown as Record<symbol, unknown>)[managedSignalSymbol]);
}

export function notifyAbortSignalWaiters(signal: AbortSignal, reason: unknown): void {
  const symSet = (signal as unknown as Record<symbol, Set<(reason: unknown) => void> | undefined>)[managedWaitersSymbol];
  if (symSet && symSet.size > 0) {
    const pending = [...symSet];
    symSet.clear();
    for (let i = 0; i < pending.length; i++) pending[i]!(reason);
  }
}

export function abortManagedController(controller: { readonly signal: AbortSignal; abort(reason?: unknown): void }, reason?: unknown): void {
  const signal = controller.signal;
  if ((signal as unknown as Record<symbol, unknown>)[managedControlSignalSymbol]) {
    controller.abort(reason);
    return;
  }
  controller.abort(reason);
  notifyAbortSignalWaiters(signal, signal.reason);
}

export function addAbortSignalWaiter(signal: AbortSignal, waiter: (reason: unknown) => void): Set<(reason: unknown) => void> {
  let waiters = (signal as unknown as Record<symbol, Set<(reason: unknown) => void> | undefined>)[managedWaitersSymbol];
  if (!waiters) {
    waiters = new Set();
    (signal as unknown as Record<symbol, Set<(reason: unknown) => void>>)[managedWaitersSymbol] = waiters;
    if (!(signal as unknown as Record<symbol, unknown>)[managedSignalSymbol]) {
      const set = waiters;
      signal.addEventListener("abort", () => {
        const reason = signal.reason;
        const pending = [...set];
        set.clear();
        for (let i = 0; i < pending.length; i++) pending[i]!(reason);
      }, { once: true });
    }
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

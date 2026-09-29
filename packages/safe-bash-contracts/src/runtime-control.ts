import type { CommandHandler, FileSystem } from "./index.js";
import { addAbortSignalWaiter, removeAbortSignalWaiter } from "./signals.js";
export { abortManagedController, addAbortSignalWaiter, combineManagedSignals, createManagedControlController, isManagedAbortSignal, isManagedControlSignal, notifyAbortSignalWaiters, registerManagedAbortSignal, removeAbortSignalWaiter, toNativeAbortSignal, type ManagedControlController, type AbortSignalWaiter } from "./signals.js";

/** Default command handlers eligible for the shell's built-in execution paths. */
export const builtInDirectContextExecutors = new WeakSet<CommandHandler>();

/** Creation mask carried through the shell's transparent filesystem views. */
export const creationUmask = Symbol("creationUmask");

const runtimeBackingFileSystems = new WeakMap<FileSystem, FileSystem>();

export function registerRuntimeBackingFileSystem(wrapper: FileSystem, backing: FileSystem): void {
  runtimeBackingFileSystems.set(wrapper, backing);
}

export function getRuntimeBackingFileSystem(fs: FileSystem): FileSystem | undefined {
  return runtimeBackingFileSystems.get(fs);
}

export function chargeRuntimeFileSystemOperation(fs: FileSystem): void {
  const backing = runtimeBackingFileSystems.get(fs) ?? fs;
  (backing as { _activeRuntimeBudget?: { fileSystemOperation(): void } })._activeRuntimeBudget?.fileSystemOperation();
}

const syncResolved = Symbol.for("safe-bash.syncResolved");
const resolvedVoid: Promise<void> = Object.defineProperty(Promise.resolve(), syncResolved, { value: true });

export function isSyncResolved(promise: unknown): promise is Promise<never> {
  return promise === resolvedVoid || Boolean(promise && typeof promise === "object" && (promise as Record<symbol, unknown>)[syncResolved]);
}

function interruptibleSlow<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    addAbortSignalWaiter(signal, reject);
    promise.then(
      value => { removeAbortSignalWaiter(signal, reject); resolve(value); },
      error => { removeAbortSignalWaiter(signal, reject); reject(error); },
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

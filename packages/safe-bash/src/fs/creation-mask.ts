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

type AbortSignalWaiter = (reason: unknown) => void;
// Pipe, output, descriptor, and yield adapters share this Set-valued protocol.
type AbortSignalWaiterStore = Set<AbortSignalWaiter> | undefined;

class ManagedControlSignalImpl implements ManagedControlController {
  readonly [managedSignalSymbol] = true;
  readonly [managedControlSignalSymbol] = true;
  [managedWaitersSymbol]: AbortSignalWaiterStore = undefined;
  #listenerMap: Map<unknown, AbortSignalWaiter> | undefined = undefined;
  aborted = false;
  reason: unknown = undefined;
  onabort: ((ev: unknown) => unknown) | null = null;
  get signal(): AbortSignal {
    return this as unknown as AbortSignal;
  }
  abort(reason?: unknown): void {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = reason !== undefined ? reason : new DOMException("This operation was aborted", "AbortError");
    notifyAbortSignalWaiters(this as unknown as AbortSignal, this.reason);
    if (typeof this.onabort === "function") {
      try { this.onabort({ type: "abort", target: this }); } catch { /* ignore */ }
    }
  }
  throwIfAborted(): void {
    if (this.aborted) throw this.reason;
  }
  addEventListener(type: string, listener: unknown): void {
    if (type !== "abort" || !listener) return;
    if (this.aborted) return;
    const map = this.#listenerMap ??= new Map();
    if (map.has(listener)) return;
    const fn: AbortSignalWaiter = () => {
      map.delete(listener);
      if (typeof listener === "function") (listener as (ev: unknown) => void)({ type: "abort", target: this });
      else if (typeof (listener as { handleEvent?: unknown }).handleEvent === "function") {
        (listener as { handleEvent: (ev: unknown) => void }).handleEvent({ type: "abort", target: this });
      }
    };
    map.set(listener, fn);
    addAbortSignalWaiter(this as unknown as AbortSignal, fn);
  }
  removeEventListener(type: string, listener: unknown): void {
    if (type !== "abort" || !listener || !this.#listenerMap) return;
    const fn = this.#listenerMap.get(listener);
    if (fn) {
      this.#listenerMap.delete(listener);
      removeAbortSignalWaiter(this as unknown as AbortSignal, fn);
    }
  }
}
Object.setPrototypeOf(ManagedControlSignalImpl.prototype, AbortSignal.prototype);

export function combineManagedSignals(primary: AbortSignal, secondary: AbortSignal, tertiary?: AbortSignal): AbortSignal {
  if (primary.aborted) return primary;
  if (secondary.aborted) return secondary;
  if (tertiary?.aborted) return tertiary;
  const combined = new ManagedControlSignalImpl();
  const onPrimary = (reason: unknown) => {
    removeAbortSignalWaiter(secondary, onSecondary);
    if (tertiary) removeAbortSignalWaiter(tertiary, onTertiary);
    combined.abort(reason);
  };
  const onSecondary = (reason: unknown) => {
    removeAbortSignalWaiter(primary, onPrimary);
    if (tertiary) removeAbortSignalWaiter(tertiary, onTertiary);
    combined.abort(reason);
  };
  const onTertiary = (reason: unknown) => {
    removeAbortSignalWaiter(primary, onPrimary);
    removeAbortSignalWaiter(secondary, onSecondary);
    combined.abort(reason);
  };
  addAbortSignalWaiter(primary, onPrimary);
  addAbortSignalWaiter(secondary, onSecondary);
  if (tertiary) addAbortSignalWaiter(tertiary, onTertiary);
  return combined.signal;
}

export function createManagedControlController(): ManagedControlController {
  return new ManagedControlSignalImpl();
}

export function isManagedControlSignal(value: unknown): value is AbortSignal {
  return Boolean(value && typeof value === "object" && (value as Record<symbol, unknown>)[managedControlSignalSymbol]);
}

export function registerManagedAbortSignal(signal: AbortSignal): AbortSignal {
  const record = signal as unknown as Record<symbol, unknown>;
  record[managedSignalSymbol] = true;
  record[managedWaitersSymbol] = undefined;
  return signal;
}

export function isManagedAbortSignal(signal: AbortSignal): boolean {
  return Boolean((signal as unknown as Record<symbol, unknown>)[managedSignalSymbol]);
}

export function notifyAbortSignalWaiters(signal: AbortSignal, reason: unknown): void {
  const record = signal as unknown as Record<symbol, AbortSignalWaiterStore>;
  const current = record[managedWaitersSymbol];
  if (!current) return;
  if (current.size > 0) {
    const pending = [...current];
    current.clear();
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

export function addAbortSignalWaiter(signal: AbortSignal, waiter: AbortSignalWaiter): void {
  const record = signal as unknown as Record<symbol, AbortSignalWaiterStore>;
  const current = record[managedWaitersSymbol];
  if (!current) {
    const set = new Set<AbortSignalWaiter>();
    set.add(waiter);
    record[managedWaitersSymbol] = set;
    if (!record[managedSignalSymbol]) {
      signal.addEventListener("abort", () => {
        const reason = signal.reason;
        const pending = [...set];
        set.clear();
        for (let i = 0; i < pending.length; i++) pending[i]!(reason);
      }, { once: true });
    }
    return;
  }
  current.add(waiter);
}

export function removeAbortSignalWaiter(signal: AbortSignal, waiter: AbortSignalWaiter): void {
  const record = signal as unknown as Record<symbol, AbortSignalWaiterStore>;
  const current = record[managedWaitersSymbol];
  if (!current) return;
  current.delete(waiter);
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

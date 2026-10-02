import { inheritYieldCheckpoint } from "./yield.js";

const managedSignalSymbol = Symbol.for("safe-bash.managedSignal");
const managedControlSignalSymbol = Symbol.for("safe-bash.managedControlSignal");
const managedWaitersSymbol = Symbol.for("safe-bash.managedWaiters");

export interface ManagedControlController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}

export type AbortSignalWaiter = ((reason: unknown) => void) | { onAbort(reason: unknown): void };
// Pipe, output, descriptor, and yield adapters share this singleton-or-Set protocol.
type AbortSignalWaiterStore = AbortSignalWaiter | Set<AbortSignalWaiter> | undefined;

class ManagedControlSignalImpl implements ManagedControlController {
  declare _waiters: AbortSignalWaiterStore;
  declare private _listenerMap: Map<unknown, AbortSignalWaiter> | undefined;
  declare private _nativeController: AbortController | undefined;
  declare aborted: boolean;
  declare reason: unknown;
  declare onabort: ((ev: unknown) => unknown) | null;

  constructor() {
    this._waiters = undefined;
    this._listenerMap = undefined;
    this._nativeController = undefined;
    this.aborted = false;
    this.reason = undefined;
    this.onabort = null;
  }

  get signal(): AbortSignal {
    return this as unknown as AbortSignal;
  }

  get hasNativeSignal(): boolean {
    return this._nativeController !== undefined;
  }

  _ensureNativeSignal(): AbortSignal {
    let ctrl = this._nativeController;
    if (!ctrl) {
      ctrl = this._nativeController = new AbortController();
      registerManagedAbortSignal(ctrl.signal);
      if (this.aborted) {
        ctrl.abort(this.reason);
      }
    }
    return ctrl.signal;
  }

  abort(reason?: unknown): void {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = reason !== undefined ? reason : new DOMException("This operation was aborted", "AbortError");
    if (this._nativeController) {
      this._nativeController.abort(this.reason);
      notifyAbortSignalWaiters(this._nativeController.signal, this.reason);
    }
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
    const map = this._listenerMap ??= new Map();
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
    if (type !== "abort" || !listener || !this._listenerMap) return;
    const fn = this._listenerMap.get(listener);
    if (fn) {
      this._listenerMap.delete(listener);
      removeAbortSignalWaiter(this as unknown as AbortSignal, fn);
    }
  }
}
Object.setPrototypeOf(ManagedControlSignalImpl.prototype, AbortSignal.prototype);
Object.defineProperties(ManagedControlSignalImpl.prototype, {
  aborted: { value: false, writable: true, configurable: true },
  reason: { value: undefined, writable: true, configurable: true },
  onabort: { value: null, writable: true, configurable: true },
  [managedSignalSymbol]: { value: true },
  [managedControlSignalSymbol]: { value: true },
  [managedWaitersSymbol]: {
    get(this: ManagedControlSignalImpl) { return this._waiters; },
    set(this: ManagedControlSignalImpl, value: AbortSignalWaiterStore) { this._waiters = value; },
  },
});

const nativeAbortSignalAny = AbortSignal.any.bind(AbortSignal);
AbortSignal.any = function any(signals: Iterable<AbortSignal>): AbortSignal {
  if (Array.isArray(signals)) {
    let hasManaged = false;
    for (let i = 0; i < signals.length; i++) {
      if (signals[i] instanceof ManagedControlSignalImpl) {
        hasManaged = true;
        break;
      }
    }
    if (!hasManaged) return nativeAbortSignalAny(signals);
    const mapped = new Array<AbortSignal>(signals.length);
    for (let i = 0; i < signals.length; i++) {
      const s = signals[i]!;
      mapped[i] = s instanceof ManagedControlSignalImpl ? s._ensureNativeSignal() : s;
    }
    return nativeAbortSignalAny(mapped);
  }
  return nativeAbortSignalAny(
    Array.from(signals, s => (s instanceof ManagedControlSignalImpl ? s._ensureNativeSignal() : s)),
  );
};

const combinedSignalWaiters = new WeakMap<AbortSignal, CombinedSignalWaiter>();

class CombinedSignalWaiter {
  declare readonly primary: AbortSignal;
  declare readonly secondary: AbortSignal;
  declare readonly tertiary: AbortSignal | undefined;
  declare readonly combined: ManagedControlSignalImpl;
  constructor(primary: AbortSignal, secondary: AbortSignal, tertiary: AbortSignal | undefined, combined: ManagedControlSignalImpl) {
    this.primary = primary;
    this.secondary = secondary;
    this.tertiary = tertiary;
    this.combined = combined;
  }
  dispose(): void {
    combinedSignalWaiters.delete(this.combined.signal);
    removeAbortSignalWaiter(this.primary, this);
    removeAbortSignalWaiter(this.secondary, this);
    if (this.tertiary) removeAbortSignalWaiter(this.tertiary, this);
  }
  onAbort(reason: unknown): void {
    this.dispose();
    this.combined.abort(reason);
  }
}

export function combineManagedSignals(primary: AbortSignal, secondary: AbortSignal, tertiary?: AbortSignal): AbortSignal {
  if (primary.aborted) return primary;
  if (secondary.aborted) return secondary;
  if (tertiary?.aborted) return tertiary;
  const combined = new ManagedControlSignalImpl();
  const waiter = new CombinedSignalWaiter(primary, secondary, tertiary, combined);
  combinedSignalWaiters.set(combined.signal, waiter);
  addAbortSignalWaiter(primary, waiter);
  addAbortSignalWaiter(secondary, waiter);
  if (tertiary) addAbortSignalWaiter(tertiary, waiter);
  return combined.signal;
}

/** Detach an owned combination without aborting borrowed inputs or completed work. */
export function releaseCombinedSignal(signal: AbortSignal): void {
  combinedSignalWaiters.get(signal)?.dispose();
}

export function createManagedControlController(): ManagedControlController {
  return new ManagedControlSignalImpl();
}

/** Materialize native Web API identity only when a signal crosses a host boundary. */
export function toNativeAbortSignal(signal: AbortSignal): AbortSignal {
  if (!(signal instanceof ManagedControlSignalImpl)) return signal;
  const native = signal._ensureNativeSignal();
  inheritYieldCheckpoint(signal, native);
  return native;
}

/** Native cancellation state belongs to the host request that materialized it. */
export function hasNativeAbortSignal(signal: AbortSignal): boolean {
  return !(signal instanceof ManagedControlSignalImpl) || signal.hasNativeSignal;
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
  if (typeof current === "function") {
    record[managedWaitersSymbol] = undefined;
    current(reason);
    return;
  }
  if ("onAbort" in current) {
    record[managedWaitersSymbol] = undefined;
    current.onAbort(reason);
    return;
  }
  if (current.size > 0) {
    const pending = [...current];
    current.clear();
    for (let i = 0; i < pending.length; i++) {
      const w = pending[i]!;
      if (typeof w === "function") w(reason);
      else w.onAbort(reason);
    }
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

const externalWaiters = new WeakMap<AbortSignal, {
  set: Set<AbortSignalWaiter>;
  listener: () => void;
}>();

export function addAbortSignalWaiter(signal: AbortSignal, waiter: AbortSignalWaiter): void {
  if (!isManagedAbortSignal(signal)) {
    let entry = externalWaiters.get(signal);
    if (!entry) {
      const set = new Set<AbortSignalWaiter>();
      const listener = (): void => {
        externalWaiters.delete(signal);
        signal.removeEventListener("abort", listener);
        const pending = [...set];
        set.clear();
        for (const waiter of pending) {
          if (typeof waiter === "function") waiter(signal.reason);
          else waiter.onAbort(signal.reason);
        }
      };
      entry = { set, listener };
      externalWaiters.set(signal, entry);
      signal.addEventListener("abort", listener, { once: true });
    }
    entry.set.add(waiter);
    return;
  }
  const record = signal as unknown as Record<symbol, AbortSignalWaiterStore>;
  const current = record[managedWaitersSymbol];
  if (!current) {
    record[managedWaitersSymbol] = waiter;
    return;
  }
  if (typeof current === "function" || "onAbort" in current) {
    if (current !== waiter) {
      const set = new Set<AbortSignalWaiter>();
      set.add(current);
      set.add(waiter);
      record[managedWaitersSymbol] = set;
    }
    return;
  }
  current.add(waiter);
}

export function removeAbortSignalWaiter(signal: AbortSignal, waiter: AbortSignalWaiter): void {
  if (!isManagedAbortSignal(signal)) {
    const entry = externalWaiters.get(signal);
    if (entry && entry.set.delete(waiter) && entry.set.size === 0) {
      signal.removeEventListener("abort", entry.listener);
      externalWaiters.delete(signal);
    }
    return;
  }
  const record = signal as unknown as Record<symbol, AbortSignalWaiterStore>;
  const current = record[managedWaitersSymbol];
  if (!current) return;
  if (typeof current === "function" || "onAbort" in current) {
    if (current === waiter) record[managedWaitersSymbol] = undefined;
    return;
  }
  current.delete(waiter);
}

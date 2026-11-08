export const managedSignalSymbol = Symbol.for("safe-bash.managedSignal");
const managedWaitersSymbol = Symbol.for("safe-bash.managedWaiters");
// Shell, output, pipe, and yield callbacks share this singleton-or-Set protocol.
type Waiter = ((reason: unknown) => void) | { onAbort(reason: unknown): void };
type Waiters = Waiter | Set<Waiter> | undefined;

export function addManagedAbortWaiter(signal: AbortSignal, waiter: Waiter): void {
  const record = signal as unknown as Record<symbol, Waiters>;
  const current = record[managedWaitersSymbol];
  if (!current) {
    record[managedWaitersSymbol] = waiter;
  }
  else if (!(current instanceof Set)) {
    if (current !== waiter) {
      const set = new Set<Waiter>();
      set.add(current);
      set.add(waiter);
      record[managedWaitersSymbol] = set;
    }
  } else current.add(waiter);
}

export function removeManagedAbortWaiter(signal: AbortSignal, waiter: Waiter): void {
  const record = signal as unknown as Record<symbol, Waiters>;
  const current = record[managedWaitersSymbol];
  if (!(current instanceof Set)) {
    if (current === waiter) record[managedWaitersSymbol] = undefined;
  } else current.delete(waiter);
}

export function notifyManagedAbortWaiters(signal: AbortSignal): void {
  const record = signal as unknown as Record<symbol, Waiters>;
  const current = record[managedWaitersSymbol];
  if (!current) return;
  if (!(current instanceof Set)) {
    record[managedWaitersSymbol] = undefined;
    if (typeof current === "function") current(signal.reason);
    else current.onAbort(signal.reason);
  } else {
    const pending = [...current];
    current.clear();
    for (const waiter of pending) {
      if (typeof waiter === "function") waiter(signal.reason);
      else waiter.onAbort(signal.reason);
    }
  }
}

interface AbortSubscription {
  readonly waiters: Set<() => void>;
  readonly listener: () => void;
}
const abortSubscriptions = new WeakMap<AbortSignal, AbortSubscription>();

/** Share one listener while work is pending; release it when the last waiter leaves. */
export function subscribeAbort(signal: AbortSignal, callback: () => void): () => void {
  signal.throwIfAborted();
  let entry = abortSubscriptions.get(signal);
  if (!entry) {
    const waiters = new Set<() => void>();
    const listener = (): void => {
      abortSubscriptions.delete(signal);
      signal.removeEventListener("abort", listener);
      const pending = [...waiters];
      waiters.clear();
      for (const waiter of pending) waiter();
    };
    entry = { waiters, listener };
    abortSubscriptions.set(signal, entry);
    signal.addEventListener("abort", listener, { once: true });
  }
  entry.waiters.add(callback);
  return () => {
    entry.waiters.delete(callback);
    if (entry.waiters.size === 0 && abortSubscriptions.get(signal) === entry) {
      abortSubscriptions.delete(signal);
      signal.removeEventListener("abort", entry.listener);
    }
  };
}

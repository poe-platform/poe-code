export const managedSignalSymbol = Symbol.for("safe-bash.managedSignal");
const managedWaitersSymbol = Symbol.for("safe-bash.managedWaiters");
type Waiter = (reason: unknown) => void;
type Waiters = Waiter | Set<Waiter> | undefined;

export function addManagedAbortWaiter(signal: AbortSignal, waiter: Waiter): void {
  const record = signal as unknown as Record<symbol, Waiters>;
  const current = record[managedWaitersSymbol];
  if (!current) {
    record[managedWaitersSymbol] = waiter;
  }
  else if (typeof current === "function") {
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
  if (typeof current === "function") {
    if (current === waiter) record[managedWaitersSymbol] = undefined;
  } else current?.delete(waiter);
}

export function notifyManagedAbortWaiters(signal: AbortSignal): void {
  const record = signal as unknown as Record<symbol, Waiters>;
  const current = record[managedWaitersSymbol];
  if (!current) return;
  if (typeof current === "function") {
    record[managedWaitersSymbol] = undefined;
    current(signal.reason);
  } else {
    const pending = [...current];
    current.clear();
    for (const waiter of pending) waiter(signal.reason);
  }
}

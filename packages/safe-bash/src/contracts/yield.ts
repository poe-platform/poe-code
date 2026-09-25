type ImmediateHost = typeof globalThis & {
  setImmediate?: (callback: () => void) => unknown;
  clearImmediate?: (handle: unknown) => void;
};

export type TurnHandle =
  | { kind: "immediate"; value: unknown }
  | { kind: "timeout"; value: ReturnType<typeof setTimeout> };
const checkpointSymbol = Symbol("safe-bash.yieldCheckpoint");
const externalCheckpointSymbol = Symbol("safe-bash.externalYieldCheckpoint");
const signalYieldStateSymbol = Symbol("safe-bash.signalYieldState");
const checkpoints = new WeakMap<AbortSignal, () => void>();
const externalCheckpoints = new WeakSet<AbortSignal>();
let checkpointCount = 0;
let externalCheckpointCount = 0;

interface SignalYieldState {
  currentAbort: (() => void) | null;
  overflowAborts: Set<() => void> | null;
}

const signalYieldStates = new WeakMap<AbortSignal, SignalYieldState>();
const managedSignalSymbol = Symbol.for("safe-bash.managedSignal");
const managedWaitersSymbol = Symbol.for("safe-bash.managedWaiters");

function getCheckpoint(signal: AbortSignal): (() => void) | undefined {
  return (signal as unknown as Record<symbol, (() => void) | undefined>)[checkpointSymbol] ?? checkpoints.get(signal);
}

function setCheckpoint(signal: AbortSignal, fn: () => void): void {
  if (Object.isExtensible(signal)) {
    (signal as unknown as Record<symbol, () => void>)[checkpointSymbol] = fn;
  } else {
    checkpoints.set(signal, fn);
  }
}

function isExternalCheckpoint(signal: AbortSignal): boolean {
  return Boolean((signal as unknown as Record<symbol, unknown>)[externalCheckpointSymbol]) || externalCheckpoints.has(signal);
}

function markExternalCheckpoint(signal: AbortSignal): void {
  if (Object.isExtensible(signal)) {
    (signal as unknown as Record<symbol, boolean>)[externalCheckpointSymbol] = true;
  } else {
    externalCheckpoints.add(signal);
  }
}

function getSignalYieldState(signal: AbortSignal): SignalYieldState {
  let state = (signal as unknown as Record<symbol, SignalYieldState | undefined>)[signalYieldStateSymbol] ?? signalYieldStates.get(signal);
  if (!state) {
    state = { currentAbort: null, overflowAborts: null };
    if (Object.isExtensible(signal)) {
      (signal as unknown as Record<symbol, SignalYieldState>)[signalYieldStateSymbol] = state;
    } else {
      signalYieldStates.set(signal, state);
    }
    const onSignalAbort = () => {
      const current = state!.currentAbort;
      state!.currentAbort = null;
      if (current) current();
      const overflow = state!.overflowAborts;
      if (overflow) {
        state!.overflowAborts = null;
        for (const fn of overflow) fn();
      }
    };
    if ((signal as unknown as Record<symbol, unknown>)[managedSignalSymbol]) {
      const record = signal as unknown as Record<symbol, Set<() => void> | undefined>;
      (record[managedWaitersSymbol] ??= new Set()).add(onSignalAbort);
    } else {
      signal.addEventListener("abort", onSignalAbort, { once: true });
    }
  }
  return state;
}

export function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function registerYieldCheckpoint(signal: AbortSignal, checkpoint: () => void): void {
  setCheckpoint(signal, checkpoint);
  markExternalCheckpoint(signal);
  checkpointCount++;
  externalCheckpointCount++;
}

export function registerInternalYieldCheckpoint(signal: AbortSignal, checkpoint: () => void): void {
  const existing = getCheckpoint(signal);
  if (existing && isExternalCheckpoint(signal)) {
    setCheckpoint(signal, () => {
      checkpoint();
      existing();
    });
  } else if (!existing) {
    setCheckpoint(signal, checkpoint);
    checkpointCount++;
  }
}

export function runYieldCheckpoint(signal?: AbortSignal): void {
  if (!signal) return;
  if (signal.aborted) throw signal.reason;
  if (checkpointCount > 0) getCheckpoint(signal)?.();
}

export function hasYieldCheckpoint(signal?: AbortSignal): boolean {
  return externalCheckpointCount > 0 && signal !== undefined && isExternalCheckpoint(signal);
}

export function hasRegisteredYieldCheckpoint(signal?: AbortSignal): boolean {
  return checkpointCount > 0 && signal !== undefined && getCheckpoint(signal) !== undefined;
}

export function inheritYieldCheckpoint(parent: AbortSignal, child: AbortSignal): void {
  if (checkpointCount === 0) return;
  const checkpoint = getCheckpoint(parent);
  if (checkpoint) {
    setCheckpoint(child, checkpoint);
    checkpointCount++;
  }
  if (externalCheckpointCount > 0 && isExternalCheckpoint(parent)) {
    markExternalCheckpoint(child);
    externalCheckpointCount++;
  }
}

export function scheduleTurn(callback: () => void): TurnHandle {
  const host = globalThis as ImmediateHost;
  return host.setImmediate
    ? { kind: "immediate", value: host.setImmediate(callback) }
    : { kind: "timeout", value: setTimeout(callback, 0) };
}

export function cancelTurn(handle: TurnHandle | undefined): void {
  if (handle?.kind === "immediate") (globalThis as ImmediateHost).clearImmediate?.(handle.value);
  else if (handle) clearTimeout(handle.value);
}

export function yieldTurn(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (signal) getCheckpoint(signal)?.();
  return new Promise<void>((resolve, reject) => {
    const host = globalThis as ImmediateHost;
    let immediateHandle: unknown;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let state: SignalYieldState | undefined;
    const finish = (): void => {
      if (state) {
        if (state.currentAbort === abort) state.currentAbort = null;
        else state.overflowAborts?.delete(abort);
      }
      resolve();
    };
    const abort = (): void => {
      if (immediateHandle !== undefined) host.clearImmediate?.(immediateHandle);
      else if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      reject(signal!.reason);
    };
    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      state = getSignalYieldState(signal);
      if (state.currentAbort === null) state.currentAbort = abort;
      else {
        state.overflowAborts ??= new Set();
        state.overflowAborts.add(abort);
      }
    }
    if (host.setImmediate) immediateHandle = host.setImmediate(finish);
    else timeoutHandle = setTimeout(finish, 0);
  });
}

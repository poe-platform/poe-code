import { addAbortSignalWaiter, isManagedAbortSignal } from "./signals.js";

type ImmediateHost = typeof globalThis & {
  setImmediate?: (callback: () => void) => unknown;
  clearImmediate?: (handle: unknown) => void;
};

export type TurnHandle =
  | { kind: "immediate"; value: unknown }
  | { kind: "timeout"; value: ReturnType<typeof setTimeout> };
const checkpointSymbol = Symbol("safe-bash.yieldCheckpoint");
const signalYieldStateSymbol = Symbol("safe-bash.signalYieldState");
interface Checkpoints {
  internal?: () => void;
  external?: () => void;
}

const checkpoints = new WeakMap<AbortSignal, Checkpoints>();
let checkpointCount = 0;
let externalCheckpointCount = 0;

interface SignalYieldState {
  currentAbort: (() => void) | null;
  overflowAborts: Set<() => void> | null;
}

const signalYieldStates = new WeakMap<AbortSignal, SignalYieldState>();

function getCheckpoints(signal: AbortSignal): Checkpoints | undefined {
  return (signal as unknown as Record<symbol, Checkpoints | undefined>)[checkpointSymbol] ?? checkpoints.get(signal);
}

function ensureCheckpoints(signal: AbortSignal): Checkpoints {
  const existing = getCheckpoints(signal);
  if (existing) return existing;
  const state: Checkpoints = {};
  if (Object.isExtensible(signal)) {
    (signal as unknown as Record<symbol, Checkpoints>)[checkpointSymbol] = state;
  } else {
    checkpoints.set(signal, state);
  }
  checkpointCount++;
  return state;
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
    if (isManagedAbortSignal(signal)) {
      addAbortSignalWaiter(signal, onSignalAbort);
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
  ensureCheckpoints(signal).external = checkpoint;
  externalCheckpointCount++;
}

export function registerInternalYieldCheckpoint(signal: AbortSignal, checkpoint: () => void): void {
  ensureCheckpoints(signal).internal = checkpoint;
}

export function runYieldCheckpoint(signal?: AbortSignal): void | Promise<void> {
  if (!signal) return;
  if (signal.aborted) throw signal.reason;
  if (checkpointCount === 0) return;
  const state = getCheckpoints(signal);
  state?.internal?.();
  state?.external?.();
}

export function hasYieldCheckpoint(signal?: AbortSignal): boolean {
  return externalCheckpointCount > 0 && signal !== undefined && getCheckpoints(signal)?.external !== undefined;
}

export function hasRegisteredYieldCheckpoint(signal?: AbortSignal): boolean {
  return checkpointCount > 0 && signal !== undefined && getCheckpoints(signal) !== undefined;
}

export function inheritYieldCheckpoint(parent: AbortSignal, child: AbortSignal): void {
  if (checkpointCount === 0) return;
  const state = getCheckpoints(parent);
  if (!state || parent === child) return;
  // Copy callbacks, not mutable state: replacing a child's budget must not
  // replace its parent's active budget.
  const inherited = ensureCheckpoints(child);
  if (state.internal) inherited.internal = state.internal;
  else delete inherited.internal;
  if (state.external) {
    inherited.external = state.external;
    externalCheckpointCount++;
  } else delete inherited.external;
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
  runYieldCheckpoint(signal);
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

export async function drainCooperativeSteps<T>(steps: Generator<void, T, void>, signal?: AbortSignal): Promise<T> {
  try {
    let next = steps.next();
    while (!next.done) {
      try {
        await yieldTurn(signal);
        next = steps.next();
      } catch (error) { next = steps.throw(error); }
    }
    return next.value;
  } finally { steps.return(undefined as T); }
}

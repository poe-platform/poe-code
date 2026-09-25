type ImmediateHost = typeof globalThis & {
  setImmediate?: (callback: () => void) => unknown;
  clearImmediate?: (handle: unknown) => void;
};

export type TurnHandle =
  | { kind: "immediate"; value: unknown }
  | { kind: "timeout"; value: ReturnType<typeof setTimeout> };
const checkpoints = new WeakMap<AbortSignal, () => void>();
const externalCheckpoints = new WeakSet<AbortSignal>();
let checkpointCount = 0;
let externalCheckpointCount = 0;

interface SignalYieldState {
  currentAbort: (() => void) | null;
  overflowAborts: Set<() => void> | null;
}

const signalYieldStates = new WeakMap<AbortSignal, SignalYieldState>();

function getSignalYieldState(signal: AbortSignal): SignalYieldState {
  let state = signalYieldStates.get(signal);
  if (!state) {
    state = { currentAbort: null, overflowAborts: null };
    signalYieldStates.set(signal, state);
    signal.addEventListener(
      "abort",
      () => {
        const current = state!.currentAbort;
        state!.currentAbort = null;
        if (current) current();
        const overflow = state!.overflowAborts;
        if (overflow) {
          state!.overflowAborts = null;
          for (const fn of overflow) fn();
        }
      },
      { once: true },
    );
  }
  return state;
}

export function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function registerYieldCheckpoint(signal: AbortSignal, checkpoint: () => void): void {
  checkpoints.set(signal, checkpoint);
  externalCheckpoints.add(signal);
  checkpointCount++;
  externalCheckpointCount++;
}

export function registerInternalYieldCheckpoint(signal: AbortSignal, checkpoint: () => void): void {
  const existing = checkpoints.get(signal);
  if (existing && externalCheckpoints.has(signal)) {
    checkpoints.set(signal, () => {
      checkpoint();
      existing();
    });
  } else if (!existing) {
    checkpoints.set(signal, checkpoint);
    checkpointCount++;
  }
}

export function runYieldCheckpoint(signal?: AbortSignal): void {
  if (!signal) return;
  if (signal.aborted) throw signal.reason;
  if (checkpointCount > 0) checkpoints.get(signal)?.();
}

export function hasYieldCheckpoint(signal?: AbortSignal): boolean {
  return externalCheckpointCount > 0 && signal !== undefined && externalCheckpoints.has(signal);
}

export function hasRegisteredYieldCheckpoint(signal?: AbortSignal): boolean {
  return checkpointCount > 0 && signal !== undefined && checkpoints.has(signal);
}

export function inheritYieldCheckpoint(parent: AbortSignal, child: AbortSignal): void {
  if (checkpointCount === 0) return;
  const checkpoint = checkpoints.get(parent);
  if (checkpoint) {
    checkpoints.set(child, checkpoint);
    checkpointCount++;
  }
  if (externalCheckpointCount > 0 && externalCheckpoints.has(parent)) {
    externalCheckpoints.add(child);
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
  if (signal) checkpoints.get(signal)?.();
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

type ImmediateHost = typeof globalThis & {
  setImmediate?: (callback: () => void) => unknown;
  clearImmediate?: (handle: unknown) => void;
};

export type TurnHandle =
  | { kind: "immediate"; value: unknown }
  | { kind: "timeout"; value: ReturnType<typeof setTimeout> };
const checkpoints = new WeakMap<AbortSignal, () => void>();

export function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function registerYieldCheckpoint(signal: AbortSignal, checkpoint: () => void): void {
  checkpoints.set(signal, checkpoint);
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
    let handle: TurnHandle | undefined;
    const finish = (): void => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = (): void => {
      cancelTurn(handle);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else handle = scheduleTurn(finish);
  });
}

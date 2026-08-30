export interface AbortSignalScope {
  readonly signal: AbortSignal;
  dispose(): void;
}

export function composeAbortSignals(signals: readonly AbortSignal[]): AbortSignalScope {
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  const dispose = (): void => {
    for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
    listeners.clear();
  };
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return { signal: controller.signal, dispose };
    }
  }
  try {
    for (const signal of new Set(signals)) {
      const listener = (): void => {
        dispose();
        controller.abort(signal.reason);
      };
      listeners.set(signal, listener);
      signal.addEventListener("abort", listener, { once: true });
      if (signal.aborted) listener();
      if (controller.signal.aborted) break;
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return { signal: controller.signal, dispose };
}

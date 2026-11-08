
export function registerManagedAbortSignal(_signal: AbortSignal): void {}
export function isManagedAbortSignal(_signal: AbortSignal): boolean { return false; }
export function addAbortSignalWaiter(signal: AbortSignal, listener: () => void): void {
  signal.addEventListener("abort", listener, { once: true });
}
export function removeAbortSignalWaiter(signal: AbortSignal, listener: () => void): void {
  signal.removeEventListener("abort", listener);
}
export function abortManagedController(controller: AbortController, reason: unknown): void {
  if (!controller.signal.aborted) controller.abort(reason);
}

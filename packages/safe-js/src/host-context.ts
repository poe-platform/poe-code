import { AsyncLocalStorage } from "#safe-js-platform";

/** Capture the current host scope before awaiting or scheduling a callback.
 * The returned function restores that scope for one synchronous continuation.
 * Call it again around later continuations; it does not change native await.
 */
export const captureHostContext: () => <Result>(callback: () => Result) => Result = AsyncLocalStorage.snapshot;

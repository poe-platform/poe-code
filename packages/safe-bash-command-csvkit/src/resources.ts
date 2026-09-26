/** Cooperative acquisition and cleanup; enrollment precedes asynchronous acquisition. */
export class ResourceScope {
  #closed = false;
  #closing: Promise<void> | undefined;
  readonly #resources: { pending: Promise<unknown>; release: (value: unknown) => Promise<void> }[] = [];
  readonly #abort = (): void => { void this.close().catch(() => {}); };
  constructor(readonly signal: AbortSignal, registerCleanup: (cleanup: () => Promise<void>) => void) {
    registerCleanup(this.close);
    if (signal.aborted) this.#abort();
    else signal.addEventListener("abort", this.#abort, { once: true });
  }
  async acquire<T>(start: () => Promise<T>, release: (value: T) => Promise<void>): Promise<T> {
    this.signal.throwIfAborted();
    if (this.#closed) throw new TypeError("resource scope closed");
    const pending = Promise.resolve().then(start);
    this.#resources.push({ pending, release: value => release(value as T) });
    const value = await pending;
    this.signal.throwIfAborted();
    if (this.#closed) throw new TypeError("resource scope closed");
    return value;
  }
  readonly close = (): Promise<void> => {
    this.#closed = true;
    this.signal.removeEventListener("abort", this.#abort);
    return this.#closing ??= (async () => {
      const failures: unknown[] = [];
      for (const resource of [...this.#resources].reverse()) {
        const [result] = await Promise.allSettled([resource.pending]);
        if (result!.status === "fulfilled") {
          try { await resource.release(result!.value); } catch (failure) { failures.push(failure); }
        }
      }
      if (failures.length) throw new CsvkitCleanupError(failures, "resource cleanup failed");
    })();
  };
}
import { CsvkitCleanupError } from "./errors.js";

import type { InvocationCleanup } from "../contracts/command.js";

export const invocationScope = Symbol("invocation cleanup scope");

export class InvocationScope {
  readonly #children = new Set<InvocationScope>();
  readonly #callbacks: InvocationCleanup[] = [];
  readonly #work = new Set<Promise<void>>();
  readonly #controller = new AbortController();
  #closed = false;
  #drain: Promise<void> | undefined;

  constructor(
    readonly callerSignal?: AbortSignal,
    readonly failures: unknown[] = [],
    readonly parent?: InvocationScope,
  ) {}

  get signal(): AbortSignal { return this.#controller.signal; }

  assertOpen(): void {
    this.callerSignal?.throwIfAborted();
    if (this.#closed) throw this.signal.reason;
    this.parent?.assertOpen();
  }

  child(): InvocationScope {
    this.assertOpen();
    const child = new InvocationScope(this.callerSignal, this.failures, this);
    this.#children.add(child);
    return child;
  }

  register(cleanup: InvocationCleanup): void {
    this.assertOpen();
    if (typeof cleanup !== "function") throw new TypeError("Cleanup must be callable");
    this.#callbacks.push(cleanup);
  }

  run<Value>(operation: () => Promise<Value>): Promise<Value> {
    this.assertOpen();
    const pending = operation();
    const settled = pending.then(() => {}, () => {});
    this.#work.add(settled);
    void settled.then(() => { this.#work.delete(settled); });
    return pending;
  }

  async cleanup(action: InvocationCleanup): Promise<void> {
    try { await action(); }
    catch (error) { this.failures.push(error); }
  }

  async drainWork(): Promise<void> {
    await Promise.all([...this.#work, ...[...this.#children].map(child => child.drainWork())]);
  }

  #seal(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const child of this.#children) child.#seal();
    this.#controller.abort(new Error("Invocation is closed"));
  }

  close(): Promise<void> {
    if (!this.#drain) {
      this.#drain = Promise.resolve().then(async () => {
        await Promise.all([
          ...this.#callbacks.map((cleanup) => this.cleanup(cleanup)),
          ...[...this.#children].map((child) => child.close()),
          ...this.#work,
        ]);
      });
      this.#seal();
    }
    return this.#drain;
  }
}

export function throwCleanupFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Invocation cleanup failed");
}

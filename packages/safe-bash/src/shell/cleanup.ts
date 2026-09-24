import type { InvocationCleanup } from "../contracts/command.js";

export const invocationScope = Symbol("invocation cleanup scope");
const invocationClosedError = new Error("Invocation is closed");
const resolvedVoid = Promise.resolve();

export class InvocationScope {
  #children: Set<InvocationScope> | undefined;
  #callbacks: Map<symbol, InvocationCleanup> | undefined;
  #finalizers: (() => void)[] | undefined;
  #work: Set<Promise<void>> | undefined;
  #activeWork = 0;
  #workWaiters: (() => void)[] | undefined;
  #controller: AbortController | undefined;
  #closed = false;
  #drain: Promise<void> | undefined;

  constructor(
    readonly callerSignal?: AbortSignal,
    readonly failures: unknown[] = [],
    readonly parent?: InvocationScope,
  ) {}

  get signal(): AbortSignal {
    if (!this.#controller) {
      this.#controller = new AbortController();
      if (this.#closed) this.#controller.abort(invocationClosedError);
    }
    return this.#controller.signal;
  }

  registerFinalizer(finalize: () => void): void {
    this.assertOpen();
    (this.#finalizers ??= []).push(finalize);
  }

  assertOpen(): void {
    this.callerSignal?.throwIfAborted();
    if (this.#closed) throw this.#controller ? this.#controller.signal.reason : invocationClosedError;
    this.parent?.assertOpen();
  }

  child(): InvocationScope {
    this.assertOpen();
    const child = new InvocationScope(this.callerSignal, this.failures, this);
    (this.#children ??= new Set()).add(child);
    return child;
  }

  register(cleanup: InvocationCleanup): () => void {
    this.assertOpen();
    if (typeof cleanup !== "function") throw new TypeError("Cleanup must be callable");
    const registration = Symbol();
    const callbacks = this.#callbacks ??= new Map();
    callbacks.set(registration, cleanup);
    return () => { callbacks.delete(registration); };
  }

  enterWork(): void {
    this.assertOpen();
    this.#activeWork++;
  }

  leaveWork(): void {
    if (--this.#activeWork === 0 && this.#workWaiters) {
      const waiters = this.#workWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
  }

  run<Value>(operation: () => Promise<Value>): Promise<Value> {
    this.assertOpen();
    const pending = operation();
    const work = this.#work ??= new Set();
    const onSettled = (): void => { work.delete(settled); };
    const settled = pending.then(onSettled, onSettled);
    work.add(settled);
    return pending;
  }

  async cleanup(action: InvocationCleanup): Promise<void> {
    try { await action(); }
    catch (error) { this.failures.push(error); }
  }

  async drainWork(): Promise<void> {
    if (!this.#work?.size && this.#activeWork === 0 && !this.#children?.size) return;
    await Promise.all([
      ...(this.#work ?? []),
      ...(this.#activeWork > 0 ? [new Promise<void>(resolve => (this.#workWaiters ??= []).push(resolve))] : []),
      ...(this.#children ? [...this.#children].map(child => child.drainWork()) : []),
    ]);
  }

  #seal(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#children) {
      for (const child of this.#children) child.#seal();
    }
    this.#controller?.abort(invocationClosedError);
  }

  close(): Promise<void> {
    if (!this.#drain) {
      this.#seal();
      if (!this.#callbacks?.size && !this.#children?.size && !this.#work?.size && this.#activeWork === 0) {
        if (this.#finalizers) {
          for (const finalize of this.#finalizers.splice(0)) {
            try { finalize(); }
            catch (error) { this.failures.push(error); }
          }
        }
        if (this.parent) this.parent.#children?.delete(this);
        this.#drain = resolvedVoid;
        return resolvedVoid;
      }
      this.#drain = Promise.resolve().then(async () => {
        const callbacks = this.#callbacks ? [...this.#callbacks.values()] : [];
        this.#callbacks?.clear();
        try {
          await Promise.all([
            ...callbacks.map((cleanup) => this.cleanup(cleanup)),
            ...(this.#children ? [...this.#children].map((child) => child.close()) : []),
            ...(this.#work ?? []),
            ...(this.#activeWork > 0 ? [new Promise<void>(resolve => (this.#workWaiters ??= []).push(resolve))] : []),
          ]);
        } finally {
          if (this.#finalizers) {
            for (const finalize of this.#finalizers.splice(0)) {
              try { finalize(); }
              catch (error) { this.failures.push(error); }
            }
          }
          if (this.parent) this.parent.#children?.delete(this);
        }
      });
    }
    return this.#drain;
  }
}

export function throwCleanupFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Invocation cleanup failed");
}

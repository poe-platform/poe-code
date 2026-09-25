import type { InvocationCleanup } from "../contracts/command.js";

export const invocationScope = Symbol("invocation cleanup scope");
const invocationClosedError = new Error("Invocation is closed");
const syncResolved = Symbol.for("safe-bash.syncResolved");
const resolvedVoid: Promise<void> = Object.defineProperty(Promise.resolve(), syncResolved, { value: true });

function isSyncResolved(promise: unknown): boolean {
  return promise === resolvedVoid || Boolean(promise && typeof promise === "object" && (promise as Record<symbol, unknown>)[syncResolved]);
}

export class InvocationScope {
  #children: Set<InvocationScope> | undefined;
  #callbacks: Map<symbol, InvocationCleanup> | undefined;
  #finalizers: (() => void | Promise<void>)[] | undefined;
  #activeWork = 0;
  #workWaiters: (() => void)[] | undefined;
  #controller: AbortController | undefined;
  #closed = false;
  #drain: Promise<void> | undefined;
  #closingSync = false;
  #reentrantResolve: (() => void) | undefined;
  #reentrantReject: ((reason: unknown) => void) | undefined;

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

  registerFinalizer(finalize: () => void | Promise<void>): void {
    this.assertOpen();
    (this.#finalizers ??= []).push(finalize);
  }

  onSeal(callback: () => void): () => void {
    if (this.#closed) {
      callback();
      return () => {};
    }
    const list = (this.#finalizers ??= []);
    list.push(callback);
    return () => {
      const idx = list.indexOf(callback);
      if (idx !== -1) list.splice(idx, 1);
    };
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
      const waiters = this.#workWaiters;
      this.#workWaiters = undefined;
      for (const resolve of waiters) resolve();
    }
  }

  run<Value>(operation: () => Promise<Value>): Promise<Value> {
    this.enterWork();
    try {
      const pending = operation();
      const onSettled = (): void => { this.leaveWork(); };
      void pending.then(onSettled, onSettled);
      return pending;
    } catch (error) {
      this.leaveWork();
      throw error;
    }
  }

  async cleanup(action: InvocationCleanup): Promise<void> {
    try { await action(); }
    catch (error) { this.failures.push(error); }
  }

  async drainWork(): Promise<void> {
    if (this.#activeWork === 0 && !this.#children?.size) return;
    await Promise.all([
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
    if (this.#drain) return this.#drain;
    if (this.#closingSync) {
      this.#drain = new Promise<void>((accept, refuse) => {
        this.#reentrantResolve = accept;
        this.#reentrantReject = refuse;
      });
      return this.#drain;
    }
    if (!this.#drain) {
      if (!this.#controller && !this.#finalizers?.length && !this.#callbacks?.size && !this.#children?.size && this.#activeWork === 0) {
        this.#drain = resolvedVoid;
        this.#seal();
        if (this.parent) this.parent.#children?.delete(this);
        return resolvedVoid;
      }
      this.#closingSync = true;
      this.#seal();
      if (!this.#callbacks?.size && !this.#children?.size && this.#activeWork === 0) {
        let asyncFinalizers: Promise<unknown>[] | undefined;
        if (this.#finalizers) {
          const finalizers = this.#finalizers;
          this.#finalizers = undefined;
          for (let i = 0; i < finalizers.length; i++) {
            const finalize = finalizers[i]!;
            try {
              const res = finalize();
              if (res && !isSyncResolved(res)) {
                (asyncFinalizers ??= []).push(Promise.resolve(res).catch(error => { this.failures.push(error); }));
              }
            }
            catch (error) { this.failures.push(error); }
          }
        }
        this.#closingSync = false;
        if (asyncFinalizers) {
          const done = Promise.all(asyncFinalizers).then(() => {
            if (this.parent) this.parent.#children?.delete(this);
          });
          if (this.#drain) {
            void done.then(this.#reentrantResolve, this.#reentrantReject);
          } else {
            this.#drain = done;
          }
          return this.#drain;
        }
        if (this.parent) this.parent.#children?.delete(this);
        if (this.#drain) {
          this.#reentrantResolve?.();
          Object.defineProperty(this.#drain, syncResolved, { value: true });
          return this.#drain;
        }
        this.#drain = resolvedVoid;
        return resolvedVoid;
      }
      this.#closingSync = false;
      const done = Promise.resolve().then(async () => {
        const callbacks = this.#callbacks ? [...this.#callbacks.values()] : [];
        this.#callbacks?.clear();
        try {
          await Promise.all([
            ...callbacks.map((cleanup) => this.cleanup(cleanup)),
            ...(this.#children ? [...this.#children].map((child) => child.close()) : []),
            ...(this.#activeWork > 0 ? [new Promise<void>(resolve => (this.#workWaiters ??= []).push(resolve))] : []),
          ]);
        } finally {
          if (this.#finalizers) {
            for (const finalize of this.#finalizers.splice(0)) {
              try {
                const res = finalize();
                if (res && !isSyncResolved(res)) await res;
              }
              catch (error) { this.failures.push(error); }
            }
          }
          if (this.parent) this.parent.#children?.delete(this);
        }
      });
      if (this.#drain) {
        void done.then(this.#reentrantResolve, this.#reentrantReject);
      } else {
        this.#drain = done;
      }
    }
    return this.#drain;
  }
}

export function throwCleanupFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Invocation cleanup failed");
}

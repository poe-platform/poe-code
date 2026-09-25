import type { InvocationCleanup } from "../contracts/command.js";
import { createManagedControlController, type ManagedControlController } from "../fs/creation-mask.js";

export const invocationScope = Symbol("invocation cleanup scope");
const invocationClosedError = new Error("Invocation is closed");
const syncResolved = Symbol.for("safe-bash.syncResolved");
const resolvedVoid: Promise<void> = Object.defineProperty(Promise.resolve(), syncResolved, { value: true });

function isSyncResolved(promise: unknown): boolean {
  return promise === resolvedVoid || Boolean(promise && typeof promise === "object" && (promise as Record<symbol, unknown>)[syncResolved]);
}

export class InvocationScope {
  declare readonly callerSignal: AbortSignal | undefined;
  declare readonly failures: unknown[];
  declare readonly parent: InvocationScope | undefined;
  declare private _children: Set<InvocationScope> | undefined;
  declare private _singleCallback: InvocationCleanup | undefined;
  declare private _regCount: number;
  declare private _callbacks: Map<number, InvocationCleanup> | undefined;
  declare private _finalizers: (() => void | Promise<void>)[] | undefined;
  declare private _activeWork: number;
  declare private _workWaiters: (() => void)[] | undefined;
  declare private _controller: ManagedControlController | undefined;
  declare private _closed: boolean;
  declare private _drain: Promise<void> | undefined;
  declare private _closingSync: boolean;
  declare private _reentrantResolve: (() => void) | undefined;
  declare private _reentrantReject: ((reason: unknown) => void) | undefined;

  constructor(
    callerSignal?: AbortSignal,
    failures: unknown[] = [],
    parent?: InvocationScope,
  ) {
    this.callerSignal = callerSignal;
    this.failures = failures;
    this.parent = parent;
    this._children = undefined;
    this._singleCallback = undefined;
    this._regCount = 0;
    this._callbacks = undefined;
    this._finalizers = undefined;
    this._activeWork = 0;
    this._workWaiters = undefined;
    this._controller = undefined;
    this._closed = false;
    this._drain = undefined;
    this._closingSync = false;
    this._reentrantResolve = undefined;
    this._reentrantReject = undefined;
  }

  get signal(): AbortSignal {
    if (!this._controller) {
      this._controller = createManagedControlController();
      if (this._closed) this._controller.abort(invocationClosedError);
    }
    return this._controller.signal;
  }

  registerFinalizer(finalize: () => void | Promise<void>): void {
    this.assertOpen();
    (this._finalizers ??= []).push(finalize);
  }

  onSeal(callback: () => void): () => void {
    if (this._closed) {
      callback();
      return () => {};
    }
    const list = (this._finalizers ??= []);
    list.push(callback);
    return () => {
      const idx = list.indexOf(callback);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  assertOpen(): void {
    this.callerSignal?.throwIfAborted();
    if (this._closed) throw this._controller ? this._controller.signal.reason : invocationClosedError;
    this.parent?.assertOpen();
  }

  child(): InvocationScope {
    this.assertOpen();
    const child = new InvocationScope(this.callerSignal, this.failures, this);
    (this._children ??= new Set()).add(child);
    return child;
  }

  register(cleanup: InvocationCleanup): () => void {
    this.assertOpen();
    if (typeof cleanup !== "function") throw new TypeError("Cleanup must be callable");
    const id = this._regCount++;
    if (id === 0) {
      this._singleCallback = cleanup;
      return () => {
        this._singleCallback = undefined;
      };
    }
    const callbacks = this._callbacks ??= new Map();
    callbacks.set(id, cleanup);
    return () => { callbacks.delete(id); };
  }

  enterWork(): void {
    this.assertOpen();
    this._activeWork++;
  }

  leaveWork(): void {
    if (--this._activeWork === 0 && this._workWaiters) {
      const waiters = this._workWaiters;
      this._workWaiters = undefined;
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
    if (this._activeWork === 0 && !this._children?.size) return;
    await Promise.all([
      ...(this._activeWork > 0 ? [new Promise<void>(resolve => (this._workWaiters ??= []).push(resolve))] : []),
      ...(this._children ? [...this._children].map(child => child.drainWork()) : []),
    ]);
  }

  private _seal(): void {
    if (this._closed) return;
    this._closed = true;
    if (this._children) {
      for (const child of this._children) child._seal();
    }
    this._controller?.abort(invocationClosedError);
  }

  close(): Promise<void> {
    if (this._drain) return this._drain;
    if (this._closingSync) {
      this._drain = new Promise<void>((accept, refuse) => {
        this._reentrantResolve = accept;
        this._reentrantReject = refuse;
      });
      return this._drain;
    }
    if (!this._drain) {
      if (!this._finalizers?.length && !this._singleCallback && !this._callbacks?.size && !this._children?.size && this._activeWork === 0) {
        this._drain = resolvedVoid;
        this._seal();
        if (this.parent) this.parent._children?.delete(this);
        return resolvedVoid;
      }
      this._closingSync = true;
      this._seal();
      if (!this._callbacks?.size && !this._children?.size && this._activeWork === 0) {
        let singleCbAsync: Promise<unknown> | undefined;
        if (this._singleCallback) {
          const cb = this._singleCallback;
          this._singleCallback = undefined;
          try {
            const res = cb();
            // Public callbacks can return promises carrying arbitrary markers.
            if (res && res !== resolvedVoid) {
              singleCbAsync = Promise.resolve(res).catch(error => { this.failures.push(error); });
            }
          } catch (error) {
            this.failures.push(error);
          }
        }
        if (!singleCbAsync && !this._callbacks?.size && !this._children?.size && this._activeWork === 0) {
        let asyncFinalizers: Promise<unknown>[] | undefined;
        if (this._finalizers) {
          const finalizers = this._finalizers;
          this._finalizers = undefined;
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
        this._closingSync = false;
        if (asyncFinalizers) {
          const done = Promise.all(asyncFinalizers).then(() => {
            if (this.parent) this.parent._children?.delete(this);
          });
          if (this._drain) {
            void done.then(this._reentrantResolve, this._reentrantReject);
          } else {
            this._drain = done;
          }
          return this._drain;
        }
        if (this.parent) this.parent._children?.delete(this);
        if (this._drain) {
          this._reentrantResolve?.();
          Object.defineProperty(this._drain, syncResolved, { value: true });
          return this._drain;
        }
        this._drain = resolvedVoid;
        return resolvedVoid;
        }
        this._closingSync = false;
        const callbacks = this._callbacks ? [...this._callbacks.values()] : [];
        this._callbacks?.clear();
        const done = Promise.resolve().then(async () => {
          try {
            await Promise.all([
              ...(singleCbAsync ? [singleCbAsync] : []),
              ...callbacks.map((cleanup) => this.cleanup(cleanup)),
              ...(this._children ? [...this._children].map((child) => child.close()) : []),
              ...(this._activeWork > 0 ? [new Promise<void>(resolve => (this._workWaiters ??= []).push(resolve))] : []),
            ]);
          } finally {
            if (this._finalizers) {
              for (const finalize of this._finalizers.splice(0)) {
                try {
                  const res = finalize();
                  if (res && !isSyncResolved(res)) await res;
                }
                catch (error) { this.failures.push(error); }
              }
            }
            if (this.parent) this.parent._children?.delete(this);
          }
        });
        if (this._drain) {
          void done.then(this._reentrantResolve, this._reentrantReject);
        } else {
          this._drain = done;
        }
        return this._drain;
      }
      this._closingSync = false;
      const singleCb = this._singleCallback;
      this._singleCallback = undefined;
      const callbacks = [
        ...(singleCb ? [singleCb] : []),
        ...(this._callbacks ? [...this._callbacks.values()] : []),
      ];
      this._callbacks?.clear();
      const done = Promise.resolve().then(async () => {
        try {
          await Promise.all([
            ...callbacks.map((cleanup) => this.cleanup(cleanup)),
            ...(this._children ? [...this._children].map((child) => child.close()) : []),
            ...(this._activeWork > 0 ? [new Promise<void>(resolve => (this._workWaiters ??= []).push(resolve))] : []),
          ]);
        } finally {
          if (this._finalizers) {
            for (const finalize of this._finalizers.splice(0)) {
              try {
                const res = finalize();
                if (res && !isSyncResolved(res)) await res;
              }
              catch (error) { this.failures.push(error); }
            }
          }
          if (this.parent) this.parent._children?.delete(this);
        }
      });
      if (this._drain) {
        void done.then(this._reentrantResolve, this._reentrantReject);
      } else {
        this._drain = done;
      }
    }
    return this._drain;
  }
}

export function throwCleanupFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Invocation cleanup failed");
}

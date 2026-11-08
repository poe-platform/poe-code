/** Stack-scoped context for hosts without native asynchronous context support.
 * Continuations scheduled by SafeJS capture and restore these stacks explicitly.
 */
export class StackContext<T> {
  private static readonly stores = new Set<WeakRef<StackContext<unknown>>>();
  private value?: T;
  private generation = 0;
  constructor() { StackContext.stores.add(new WeakRef(this)); }
  getStore(): T | undefined { return this.value; }
  run<Result>(value: T, callback: () => Result): Result {
    const previous = this.value;
    const generation = this.generation;
    this.value = value;
    try { return callback(); }
    finally { if (this.generation === generation) this.value = previous; }
  }
  exit<Result>(callback: () => Result): Result {
    const previous = this.value;
    const generation = this.generation;
    this.value = undefined;
    try { return callback(); }
    finally { if (this.generation === generation) this.value = previous; }
  }
  disable(): void { this.value = undefined; this.generation++; }
  static snapshot(): <Result>(callback: () => Result) => Result {
    const values = new Map<StackContext<unknown>, readonly [unknown, number]>();
    for (const reference of StackContext.stores) {
      const store = reference.deref();
      if (store === undefined) StackContext.stores.delete(reference);
      else values.set(store, [store.value, store.generation]);
    }
    return callback => {
      const restore: Array<readonly [StackContext<unknown>, unknown, number]> = [];
      // A later-created execution must not leak its ambient context into an
      // earlier continuation. Save and clear every live store, not only those
      // that existed when the continuation was captured.
      for (const reference of StackContext.stores) {
        const store = reference.deref();
        if (store === undefined) { StackContext.stores.delete(reference); continue; }
        restore.push([store, store.value, store.generation]);
        const captured = values.get(store);
        store.value = captured?.[1] === store.generation ? captured[0] : undefined;
      }
      try { return callback(); }
      finally {
        for (const [store, value, generation] of restore)
          if (store.generation === generation) store.value = value;
      }
    };
  }
}

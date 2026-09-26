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
    const values: Array<readonly [StackContext<unknown>, unknown, number]> = [];
    for (const reference of StackContext.stores) {
      const store = reference.deref();
      if (store === undefined) StackContext.stores.delete(reference);
      else values.push([store, store.value, store.generation]);
    }
    return callback => {
      const restore = values.map(([store]) => store.value);
      for (const [store, value, generation] of values) if (store.generation === generation) store.value = value;
      try { return callback(); }
      finally { values.forEach(([store, , generation], index) => { if (store.generation === generation) store.value = restore[index]; }); }
    };
  }
}

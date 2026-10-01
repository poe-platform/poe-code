export type DataCopyOperation<T, Result = T> = Generator<DataCopyOperation<T>, Result, T>;

const prototype = Object.getPrototypeOf((function* () {})());
const next = prototype.next;
const raise = prototype.throw;
const finish = prototype.return;
const apply = Reflect.apply;
const setPrototypeOf = Object.setPrototypeOf;

// Delegated serializers need the same private native methods as the driver.
export function dataCopyIterable<T, Result>(operation: DataCopyOperation<T, Result>): Iterable<DataCopyOperation<T>, Result, T> {
  return {
    [Symbol.iterator]() {
      return {
        next: (value?: T) => apply(next, operation, [value]),
        throw: (error: unknown) => apply(raise, operation, [error]),
        return: (value: Result) => apply(finish, operation, [value])
      };
    }
  };
}

// Each child copy suspends its parent's exact expression and iterator state.
// Native generator methods stay private even if a provider replaces their
// shared prototype methods while a copy is suspended.
export function runDataCopy<T, Result = T>(operation: DataCopyOperation<T, Result>): Result {
  const parents: Array<DataCopyOperation<T, T | Result> | undefined> = setPrototypeOf([], null);
  let depth = 0;
  let current: DataCopyOperation<T, T | Result> = operation;
  let method = next;
  let input: unknown;
  while (true) {
    let result: IteratorResult<DataCopyOperation<T>, T | Result>;
    try {
      result = apply(method, current, [input]);
    } catch (error) {
      if (depth === 0) throw error;
      current = parents[--depth]!;
      parents[depth] = undefined;
      method = raise;
      input = error;
      continue;
    }
    method = next;
    if (result.done) {
      if (depth === 0) return result.value as Result;
      current = parents[--depth]!;
      parents[depth] = undefined;
      input = result.value;
    } else {
      parents[depth++] = current;
      current = result.value;
      input = undefined;
    }
  }
}

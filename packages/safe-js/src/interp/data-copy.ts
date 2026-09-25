export type DataCopyOperation<T> = Generator<DataCopyOperation<T>, T, T>;

const prototype = Object.getPrototypeOf((function* () {})());
const next = prototype.next;
const raise = prototype.throw;
const apply = Reflect.apply;
const setPrototypeOf = Object.setPrototypeOf;

// Each child copy suspends its parent's exact expression and iterator state.
// Native generator methods stay private even if a provider replaces their
// shared prototype methods while a copy is suspended.
export function runDataCopy<T>(operation: DataCopyOperation<T>): T {
  const parents: Array<DataCopyOperation<T> | undefined> = setPrototypeOf([], null);
  let depth = 0;
  let current = operation;
  let method = next;
  let input: unknown;
  while (true) {
    let result: IteratorResult<DataCopyOperation<T>, T>;
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
      if (depth === 0) return result.value;
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

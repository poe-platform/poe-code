import type { ExecutionMeter } from "./execution-budget.js";

export interface StableSortContext<Value, Key> {
  /** Called once per captured source element, in original order. */
  key(value: Value): Key;
  /** Guest less-than followed by truth conversion; no equality is required. */
  less(left: Key, right: Key): boolean;
  readonly reverse?: boolean;
}

/** Stable natural merge sort with bounded O(n log n) work and O(n) slots.
 * Ascending/strict descending runs are recognized in linear time. Strictness
 * prevents reversing equal-key identities. Merges choose the left element on
 * ties, including reverse ordering. Source slots are captured before key calls.
 * This is a sorting kernel, not list.sort's temporary-empty/mutation lifecycle.
 * Comparison scheduling is not CPython's powersort/galloping schedule; exact
 * callback traces and outcomes with inconsistent orderings can differ. Native
 * allocation overhead, callback recursion and guest dispatch remain external.
 */
export function stableSort<Value, Key>(source: readonly Value[], context: StableSortContext<Value, Key>, meter: ExecutionMeter): Value[] {
  const length = source.length;
  meter.checkpoint(1, 64 + length * 16);
  let values = new Array<Value>(length), keys = new Array<Key>(length);
  for (let i = 0; i < length; i++) { meter.checkpoint(); values[i] = source[i]; }
  for (let i = 0; i < length; i++) {
    meter.checkpoint();
    keys[i] = context.key(values[i]);
    meter.checkpoint();
  }
  if (length < 2) return values;
  const reverse = context.reverse === true;
  const before = (a: Key, b: Key): boolean => {
    meter.checkpoint();
    const result = reverse ? context.less(b, a) : context.less(a, b);
    meter.checkpoint();
    return result;
  };
  meter.checkpoint(0, 32);
  const runs: number[] = [];
  for (let start = 0; start < length;) {
    let end = start + 1;
    if (end < length) {
      const descending = before(keys[end], keys[start]);
      end++;
      while (end < length && before(keys[end], keys[end - 1]) === descending) end++;
      if (descending) {
        meter.checkpoint(Math.floor((end - start) / 2));
        for (let a = start, b = end - 1; a < b; a++, b--) {
          const value = values[a], key = keys[a];
          values[a] = values[b]; keys[a] = keys[b];
          values[b] = value; keys[b] = key;
        }
      }
    }
    meter.checkpoint(1, 8); runs.push(end); start = end;
  }
  if (runs.length === 1) return values;
  meter.checkpoint(1, 64 + length * 16);
  let output = new Array<Value>(length), outputKeys = new Array<Key>(length);
  while (runs.length > 1) {
    let nextRun = 0;
    for (let run = 0; run < runs.length; run += 2) {
      const start = run === 0 ? 0 : runs[run - 1], middle = runs[run], end = runs[run + 1] ?? length;
      let left = start, right = middle;
      for (let out = start; out < end; out++) {
        meter.checkpoint();
        const from = left >= middle || (right < end && before(keys[right], keys[left])) ? right++ : left++;
        output[out] = values[from]; outputKeys[out] = keys[from];
      }
      runs[nextRun++] = end;
    }
    runs.length = nextRun;
    const oldValues = values, oldKeys = keys;
    values = output; keys = outputKeys; output = oldValues; outputKeys = oldKeys;
  }
  return values;
}

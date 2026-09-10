import type { ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { IntegerProgression } from "./integer-sequence.js";
import { RangeIterator } from "./range-iterator.js";
import type { RuntimeValue } from "./runtime-values.js";
import type { CompletionIterator } from "./iterator-completion.js";

/** Wrap lazy progression results as guest integers for both traversal
 * directions. Cursor and per-result allocations use the same execution meter. */
export function createRuntimeRangeIterator(range: IntegerProgression, reverse: boolean, values: ConstantValues, meter: ExecutionMeter): CompletionIterator<RuntimeValue> {
  meter.checkpoint(1, 96);
  const cursor = new RangeIterator(range, reverse, meter);
  return {
    lengthHint: cursor.lengthHint.bind(cursor),
    next() {
      meter.checkpoint(1, 16);
      const item = cursor.next();
      return item.done ? { done: true, value: undefined } : { done: false, value: values.integer(item.value) };
    }
  };
}

import type { Budget } from "./budget.js";

export async function boundedSort<Value>(values: Value[], entryBytes: number, budget: Budget, compare: (left: Value, right: Value) => number | Promise<number>): Promise<void> {
  if (values.length < 2) return;
  budget.hold(values.length * entryBytes);
  try {
    const scratch = new Array<Value>(values.length);
    let source = values;
    let target = scratch;
    for (let width = 1; width < values.length; width *= 2) {
      for (let begin = 0; begin < values.length; begin += width * 2) {
        const middle = Math.min(begin + width, values.length);
        const end = Math.min(begin + width * 2, values.length);
        let left = begin;
        let right = middle;
        for (let index = begin; index < end; index++) {
          budget.work();
          if (left < middle && (right === end || await compare(source[left]!, source[right]!) <= 0)) target[index] = source[left++]!;
          else target[index] = source[right++]!;
          if ((index & 1023) === 0) await budget.checkpoint();
        }
      }
      [source, target] = [target, source];
    }
    if (source !== values) for (let index = 0; index < values.length; index++) {
      budget.work(); values[index] = source[index]!;
      if ((index & 1023) === 0) await budget.checkpoint();
    }
  } finally { budget.release(values.length * entryBytes); }
}

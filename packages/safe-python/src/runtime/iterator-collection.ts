import type { ExecutionMeter } from "./execution-budget.js";

/** Materialize an already-prepared guest iterator without closing it on failure.
 * Preparation/length hints and guest next dispatch belong to the caller. */
export function collectIterator<Value>(iterator: Iterator<Value>, meter: ExecutionMeter): Value[] {
  meter.checkpoint(0, 32);
  const items: Value[] = [];
  while (true) {
    meter.checkpoint();
    const item = iterator.next();
    meter.checkpoint();
    if (item.done) return items;
    meter.checkpoint(0, 8);
    items.push(item.value);
  }
}

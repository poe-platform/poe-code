import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";
import { EnumerateIterator } from "./enumerate-iterator.js";

export interface EnumerateIterableContext<Value, Result> extends IterationContext<Value> {
  /** Guest integer-index protocol, not truncation or general int conversion. */
  index(value: Value): bigint;
  pair(index: bigint, value: Value): Result;
}

/** Bind calls to the exact enumerate builtin, preserving its keyword-order and
 * argument-count diagnostics. Explicit start conversion precedes eager iterable
 * acquisition. Call assembly owns duplicate/non-string keywords; subclass
 * construction and guest builtin registration are separate responsibilities.
 */
export function enumerateIterable<Value, Result>(positional: readonly Value[], keywords: ReadonlyMap<string, Value>, context: EnumerateIterableContext<Value, Result>, meter: ExecutionMeter): EnumerateIterator<Value, Result> {
  meter.checkpoint();
  const count = positional.length + keywords.size;
  if (count !== 1 && count !== 2) {
    throw new PythonRuntimeError("TypeError", positional.length === 0
      ? "enumerate() missing required argument 'iterable'"
      : `enumerate() takes at most 2 arguments (${count} given)`);
  }
  let keywordIndex = 0, startFirst = false;
  for (const name of keywords.keys()) {
    meter.checkpoint();
    if (keywords.size === 2 && keywordIndex === 0) startFirst = name === "start";
    const expected = keywords.size === 2
      ? (keywordIndex === 0) === startFirst ? "start" : "iterable"
      : count === 1 ? "iterable" : "start";
    if (name !== expected) throw new PythonRuntimeError("TypeError", `'${name}' is an invalid keyword argument for enumerate()`);
    keywordIndex++;
  }
  const iterable = positional.length > 0 ? positional[0] : keywords.get("iterable") as Value;
  const start = count === 1 ? 0n : context.index(positional.length === 2 ? positional[1] : keywords.get("start") as Value);
  meter.checkpoint(1, 32);
  const source = new ProtocolIterator(iterable, context, meter);
  return new EnumerateIterator(source, start, context.pair.bind(context), meter);
}

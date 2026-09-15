import type { ExecutionMeter } from "./execution-budget.js";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";
import { protocolTruth, type TruthProtocolContext } from "./truth-protocol.js";

export interface IterableTruthContext<Value> extends IterationContext<Value>, TruthProtocolContext<Value> {}

/** Shared any/all reduction over guest iteration and truth protocols. Only
 * source StopIteration means exhaustion: truth errors propagate unchanged.
 * Consumption stops at the first decisive element, without closing the input
 * or querying a length hint. Call binding, guest bool wrapping and builtin
 * registration remain outside this reduction.
 */
export function iterableTruth<Value>(operation: "any" | "all", source: Value, context: IterableTruthContext<Value>, meter: ExecutionMeter): boolean {
  const iterator = new ProtocolIterator(source, context, meter);
  const decisive = operation === "any";
  while (true) {
    meter.checkpoint();
    const item = iterator.next();
    if (item.done) return !decisive;
    if (protocolTruth(item.value, context, meter) === decisive) return decisive;
  }
}

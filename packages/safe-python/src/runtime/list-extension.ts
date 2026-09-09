import type { ExecutionMeter } from "./execution-budget.js";
import type { ListStorage } from "./list-storage.js";
import { lengthHint, type LengthHintContext } from "./length-hint.js";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";

export interface ListExtensionContext<Value> extends IterationContext<Value>, LengthHintContext<Value> {
  /** Return storage for exact guest lists only; subclasses must retain their
   * iterable dispatch. This is type inspection, not a guest method call. */
  exactList(value: Value): ListStorage<Value> | undefined;
}

/** Connect guest iterable preparation to owned list extension. Iterator creation
 * precedes the original source's length/hint protocol, then items stream into
 * the target. Exact list self-extension retains its finite optimized path.
 * Hints are validated for their protocol effects but not used for speculative
 * capacity allocation: actual appended slots are charged by storage. Thus huge
 * valid advisory hints do not reproduce CPython preallocation MemoryError.
 * Guest method argument binding and None return values are separate.
 */
export function extendList<Value>(target: ListStorage<Value>, source: Value, context: ListExtensionContext<Value>, meter: ExecutionMeter): void {
  meter.checkpoint();
  const exact = context.exactList(source);
  if (exact !== undefined) {
    target.extend(exact);
    return;
  }
  const iterator = new ProtocolIterator(source, context, meter);
  lengthHint(source, context, meter, 8n);
  target.extendIterator(iterator);
}

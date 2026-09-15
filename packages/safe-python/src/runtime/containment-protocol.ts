import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";

export interface ContainmentContext<Value> extends IterationContext<Value> {
  /** Type-level bound slot. undefined is absent; null is disabled with None. */
  lookupContains(container: Value): ((needle: Value) => Value) | null | undefined;
  /** Rich equality of member against needle, not the reverse order. */
  equal(member: Value, needle: Value): Value;
  truth(value: Value): boolean;
  /** Guest TypeError/subclasses only, never host termination signals. */
  isTypeError(error: unknown): boolean;
}

/** Contains-slot truth or iteration fallback with identity-before-equality.
 * Only iterator-acquisition TypeErrors are rewritten; later failures propagate.
 * No length hint or implicit iterator close is requested, including early exits.
 * Guest slot/type construction and recursive-call policies belong to context. */
export function protocolContains<Value>(needle: Value, container: Value, context: ContainmentContext<Value>, meter: ExecutionMeter): boolean {
  meter.checkpoint();
  const contains = context.lookupContains(container);
  meter.checkpoint();
  if (contains === null) throw new PythonRuntimeError("TypeError", `'${diagnosticTypeName(context.typeName(container), meter)}' object is not a container`);
  if (contains !== undefined) {
    const result = contains(needle); meter.checkpoint();
    const found = context.truth(result); meter.checkpoint();
    return found;
  }
  let iterator: ProtocolIterator<Value>;
  try { iterator = new ProtocolIterator(container, context, meter); }
  catch (error) {
    meter.checkpoint();
    const replace = context.isTypeError(error); meter.checkpoint();
    if (!replace) throw error;
    throw new PythonRuntimeError("TypeError", `argument of type '${diagnosticTypeName(context.typeName(container), meter)}' is not a container or iterable`);
  }
  for (;;) {
    meter.checkpoint(); const item = iterator.next(); meter.checkpoint();
    if (item.done) return false;
    if (item.value === needle) return true;
    const equal = context.equal(item.value, needle); meter.checkpoint();
    const found = context.truth(equal); meter.checkpoint();
    if (found) return true;
  }
}

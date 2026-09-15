import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { optionalLength, type LengthProtocolContext } from "./length-protocol.js";

export interface TruthProtocolContext<Value> extends LengthProtocolContext<Value> {
  /** Pure inspection of exact builtin bool payloads and None identity. */
  boolean(value: Value): boolean | undefined;
  isNone(value: Value): boolean;
  /** Type-level lookup/binding: undefined means absent, null means explicitly
   * disabled with None. Other non-callable values fail through the bound call.
   * Builtin numeric/container slots must also be provided by this context. */
  lookupBool(value: Value): (() => Value) | null | undefined;
}

export type BooleanTruthContext<Value> = Pick<TruthProtocolContext<Value>, "boolean" | "isNone" | "lookupBool" | "typeName">;

/** Guest truth conversion with bool-before-length precedence. A present bool
 * method must return an exact bool; invalid results and errors never enable
 * length fallback. Slotless objects are true. Concrete type/descriptor dispatch,
 * recursive-call limits and complete allocation accounting remain external.
 */
export function protocolTruth<Value>(value: Value, context: TruthProtocolContext<Value>, meter: ExecutionMeter): boolean {
  const truth = optionalBooleanTruth(value, context, meter);
  if (truth !== undefined) return truth;
  const length = optionalLength(value, context, meter);
  return length === undefined || length !== 0n;
}

/** Resolve bool/None and __bool__ without acquiring a length/index policy.
 * Undefined alone permits length fallback; false is a completed conversion. */
export function optionalBooleanTruth<Value>(value: Value, context: BooleanTruthContext<Value>, meter: ExecutionMeter): boolean | undefined {
  meter.checkpoint();
  const direct = context.boolean(value);
  if (direct !== undefined) return direct;
  if (context.isNone(value)) return false;
  const method = context.lookupBool(value);
  meter.checkpoint();
  if (method === null) throw new PythonRuntimeError("TypeError", `'${context.typeName(value)}' cannot be interpreted as a boolean`);
  if (method !== undefined) {
    const result = method();
    meter.checkpoint();
    const truth = context.boolean(result);
    if (truth === undefined) throw new PythonRuntimeError("TypeError", `__bool__ should return bool, returned ${context.typeName(result)}`);
    return truth;
  }
  return undefined;
}

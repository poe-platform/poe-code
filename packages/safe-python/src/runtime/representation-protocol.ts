import type { CodePointString } from "./code-point-string.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface RepresentationContext<Value> {
  isExactString(value: Value): boolean;
  /** Pure str/subclass storage inspection; never convert the returned object. */
  string(value: Value): CodePointString | undefined;
  /** Bound type-level slots. Only absence returns undefined; disabled or
   * non-callable slots must fail through lookup/invocation. */
  lookupStr(value: Value): (() => Value) | undefined;
  lookupRepr(value: Value): (() => Value) | undefined;
  /** Runtime-owned default object representation, including identity policy. */
  defaultRepr(value: Value): Value;
  typeName(value: Value): string;
  /** Construct an exact str from immutable, already-metered storage. */
  stringPoints(value: CodePointString): Value;
}

/** Resolve str/repr/ascii while preserving string-subclass results and identity.
 * No method-result recursion or warning for str subclasses occurs. Recursion
 * guards and native/container representation dispatch belong to the slot layer.
 */
export function representationObject<Value>(value: Value, mode: "str" | "repr" | "ascii", context: RepresentationContext<Value>, meter: ExecutionMeter): Value {
  meter.checkpoint();
  if (mode === "str") {
    const exact = context.isExactString(value); meter.checkpoint();
    if (exact) return value;
  }
  let method: (() => Value) | undefined;
  let methodName = mode === "str" ? "str" : "repr";
  if (mode === "str") { method = context.lookupStr(value); meter.checkpoint(); }
  if (method === undefined) { methodName = "repr"; method = context.lookupRepr(value); meter.checkpoint(); }
  const result = method === undefined ? context.defaultRepr(value) : method();
  meter.checkpoint();
  const storage = context.string(result); meter.checkpoint();
  if (storage === undefined) throw new PythonRuntimeError("TypeError", `__${methodName}__ returned non-string (type ${diagnosticTypeName(context.typeName(result), meter)})`);
  if (mode !== "ascii") return result;
  const escaped = storage.escapeAscii(meter);
  meter.checkpoint();
  if (escaped === storage) return result;
  const output = context.stringPoints(escaped); meter.checkpoint();
  return output;
}

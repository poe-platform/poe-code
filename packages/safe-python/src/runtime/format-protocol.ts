import { CodePointString } from "./code-point-string.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { representationObject, type RepresentationContext } from "./representation-protocol.js";
import type { NumericLocale } from "./numeric-locale.js";

export interface FormatContext<Value> extends RepresentationContext<Value> {
  /** Execution-owned numeric locale shared by native formatting descriptors. */
  numericLocale?(): NumericLocale;
  /** Exact int only, excluding bool and int subclasses. */
  isExactInteger(value: Value): boolean;
  /** Bound type-level __format__. Undefined is absence only; lookup and calls
   * must preserve errors from disabled/non-callable slots and descriptors. */
  lookupFormat(value: Value): ((spec: Value) => Value) | undefined;
}

const empty = new Uint32Array(0);

/** Internal object formatting protocol, not the format() argument parser.
 * Omitted specs become exact empty str after the exact str/int fast paths.
 * Native/inherited __format__ implementations own their supported specs; an
 * absent slot must not be fabricated as an object.__format__ fallback. */
export function formatObject<Value>(value: Value, spec: Value | undefined, context: FormatContext<Value>, meter: ExecutionMeter): Value {
  meter.checkpoint();
  let storage: CodePointString | undefined;
  if (spec !== undefined) {
    storage = context.string(spec); meter.checkpoint();
    if (storage === undefined) throw new PythonRuntimeError("SystemError", `Format specifier must be a string, not ${diagnosticTypeName(context.typeName(spec), meter)}`);
  }
  if (storage === undefined || storage.length === 0) {
    const string = context.isExactString(value); meter.checkpoint();
    if (string) return value;
    const integer = context.isExactInteger(value); meter.checkpoint();
    if (integer) return representationObject(value, "str", context, meter);
  }
  if (spec === undefined) { spec = context.stringPoints(new CodePointString(empty, meter)); meter.checkpoint(); }
  return formatSlot(value, spec, context, meter);
}

/** Invoke and validate a formatting slot with an already validated string spec.
 * Native methods and brace formatting do not use format()'s empty-int shortcut. */
export function formatSlot<Value>(value: Value, spec: Value, context: FormatContext<Value>, meter: ExecutionMeter): Value {
  meter.checkpoint();
  const method = context.lookupFormat(value); meter.checkpoint();
  if (method === undefined) throw new PythonRuntimeError("TypeError", `Type ${diagnosticTypeName(context.typeName(value), meter, 100)} doesn't define __format__`);
  const result = method(spec); meter.checkpoint();
  const text = context.string(result); meter.checkpoint();
  if (text === undefined) throw new PythonRuntimeError("TypeError", `__format__ must return a str, not ${diagnosticTypeName(context.typeName(result), meter)}`);
  return result;
}

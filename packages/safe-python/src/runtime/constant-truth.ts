import type { PrimitiveConstant, TupleConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

/** Truth slots for exact builtin constant values, not subclass or user-object
 * dispatch. Container members are never coerced. The wider object runtime must
 * resolve overridden __bool__/__len__ slots before using exact builtin behavior.
 */
export function constantTruth(value: PrimitiveConstant | TupleConstant<unknown>, meter: ExecutionMeter): boolean {
  meter.checkpoint();
  switch (value.kind) {
    case "none": return false;
    case "ellipsis": return true;
    case "not-implemented": throw new PythonRuntimeError("TypeError", "NotImplemented should not be used in a boolean context");
    case "bool": return value.value;
    case "int": return value.value !== 0n;
    case "float": return value.value !== 0;
    case "complex": return value.real !== 0 || value.imaginary !== 0;
    case "str":
    case "bytes": return value.value.length !== 0;
    case "tuple": return value.items.length !== 0;
  }
}

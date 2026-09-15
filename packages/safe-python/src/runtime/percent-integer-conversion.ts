import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { integerIndex, type IntegerIndexContext } from "./index-protocol.js";
import { floatToInteger } from "./numeric-conversion.js";

export interface PercentIntegerContext<Value> extends IntegerIndexContext<Value> {
  /** Exact float payload only; float subclasses must use their __int__ slot. */
  float(value: Value): number | undefined;
  /** Bound type-level __int__, not instance lookup or string parsing. */
  lookupInt(value: Value): (() => Value) | undefined;
  /** Classify guest TypeError instances, including guest subclasses. */
  isTypeError?(error: unknown): boolean;
}

/** Integer percent operands: decimal conversions use __int__, then __index__;
 * octal/hex use only indexing. TypeError is rewritten for the original operand,
 * other guest errors propagate, and fatal execution limits remain uncatchable. */
export function percentInteger<Value>(value: Value, code: number, context: PercentIntegerContext<Value>, meter: ExecutionMeter): bigint {
  meter.checkpoint();
  const decimal = code === 100 || code === 105 || code === 117;
  if (!decimal && code !== 111 && code !== 120 && code !== 88) throw new RangeError("unsupported integer percent conversion");
  try {
    const direct = context.integer(value); meter.checkpoint();
    if (direct !== undefined) return direct;
    if (decimal) {
      const floating = context.float(value); meter.checkpoint();
      if (floating !== undefined) {
        // Finite binary64 requires at most 1,024 integer bits plus object space.
        meter.checkpoint(1, 160);
        const result = floatToInteger(floating); meter.checkpoint();
        return result;
      }
      const method = context.lookupInt(value); meter.checkpoint();
      if (method !== undefined) {
        const result = method(); meter.checkpoint();
        const integer = context.integer(result); meter.checkpoint();
        if (integer === undefined) throw new PythonRuntimeError("TypeError", "__int__ returned non-int");
        const exact = context.isExactInteger(result); meter.checkpoint();
        if (!exact) {
          const name = diagnosticTypeName(context.typeName(result), meter);
          context.warn("DeprecationWarning", `__int__ returned non-int (type ${name}).  The ability to return an instance of a strict subclass of int is deprecated, and may be removed in a future version of Python.`);
          meter.checkpoint();
        }
        return integer;
      }
    }
    const result = integerIndex(value, context, meter); meter.checkpoint();
    return result;
  } catch (error) {
    if (error instanceof ExecutionLimitError) throw error;
    meter.checkpoint();
    const typeError = error instanceof PythonRuntimeError && error.name === "TypeError" || context.isTypeError?.(error) === true;
    meter.checkpoint();
    if (!typeError) throw error;
  }
  const name = diagnosticTypeName(context.typeName(value), meter);
  throw new PythonRuntimeError("TypeError", `%${String.fromCharCode(code)} format: ${decimal ? "a real number" : "an integer"} is required, not ${name}`);
}

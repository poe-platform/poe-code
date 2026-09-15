import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { validateIndexResult, type IntegerIndexContext } from "./index-protocol.js";
import { integerToFloat } from "./numeric-conversion.js";

export interface PercentFloatContext<Value> extends IntegerIndexContext<Value> {
  /** Pure float/subclass payload inspection; subclasses bypass __float__. */
  floating(value: Value): number | undefined;
  isExactFloat(value: Value): boolean;
  /** Bound type-level slot; disabled/non-callable slots must fail, not be absent. */
  lookupFloat(value: Value): (() => Value) | undefined;
  /** Includes guest BaseException subclasses, but never host implementation errors. */
  isPythonException?(error: unknown): boolean;
}

/** Resolve a floating percent operand without parsing strings. Text preserves
 * conversion faults; bytes replaces every guest conversion fault with TypeError.
 * Fatal execution limits and host failures always propagate unchanged. */
export function percentFloat<Value>(value: Value, byteFormat: boolean, context: PercentFloatContext<Value>, meter: ExecutionMeter): number {
  meter.checkpoint();
  try {
    const direct = context.floating(value); meter.checkpoint();
    if (direct !== undefined) return direct;
    const method = context.lookupFloat(value); meter.checkpoint();
    if (method !== undefined) {
      const result = method(); meter.checkpoint();
      const floating = context.floating(result); meter.checkpoint();
      if (floating === undefined) throw new PythonRuntimeError("TypeError", `${diagnosticTypeName(context.typeName(value), meter, 50)}.__float__ returned non-float (type ${diagnosticTypeName(context.typeName(result), meter, 50)})`);
      const exact = context.isExactFloat(result); meter.checkpoint();
      if (!exact) {
        context.warn("DeprecationWarning", `${diagnosticTypeName(context.typeName(value), meter, 50)}.__float__ returned non-float (type ${diagnosticTypeName(context.typeName(result), meter, 50)}).  The ability to return an instance of a strict subclass of float is deprecated, and may be removed in a future version of Python.`);
        meter.checkpoint();
      }
      return floating;
    }
    let integer = context.integer(value); meter.checkpoint();
    if (integer === undefined) {
      const index = context.lookupIndex(value); meter.checkpoint();
      if (index === undefined) throw new PythonRuntimeError("TypeError", `must be real number, not ${diagnosticTypeName(context.typeName(value), meter, 50)}`);
      const result = validateIndexResult(index(), context, meter);
      integer = context.integer(result); meter.checkpoint();
    }
    const floating = integerToFloat(integer as bigint); meter.checkpoint();
    return floating;
  } catch (error) {
    if (!byteFormat || error instanceof ExecutionLimitError) throw error;
    meter.checkpoint();
    const guest = error instanceof PythonRuntimeError || context.isPythonException?.(error) === true;
    meter.checkpoint();
    if (!guest) throw error;
  }
  throw new PythonRuntimeError("TypeError", `float argument required, not ${diagnosticTypeName(context.typeName(value), meter)}`);
}

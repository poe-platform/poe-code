import { dispatchBinaryOperation, type BinaryDispatch } from "./binary-dispatch.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { floatDivmod } from "./float-arithmetic.js";
import { integerDivmod } from "./integer-arithmetic.js";
import { integerBitMetric } from "./integer-bit-metric.js";
import { integerToFloat } from "./numeric-conversion.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface DivmodContext {
  /** Prepare type-level __divmod__/__rdivmod__ negotiation, including native
   * slots for mixed native/guest pairs. Undefined selects exact real kernels.
   * The dispatch sentinel must belong to this execution. */
  numeric?(left: RuntimeValue, right: RuntimeValue): BinaryDispatch<RuntimeValue> | undefined;
  typeName?(value: RuntimeValue): string;
}

/** Explicit positional-only builtin registration. Guest results are unrestricted;
 * divmod is its own numeric protocol, never separate // and % dispatches. */
export function createDivmodBuiltin(values: RuntimeValues, meter: ExecutionMeter, context: DivmodContext = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({ name: "divmod", invoke(positional, keywords, meter) {
    meter.checkpoint();
    if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "divmod() takes no keyword arguments");
    if (positional.length !== 2) throw new PythonRuntimeError("TypeError", `divmod expected 2 arguments, got ${positional.length}`);
    const [left, right] = positional, numeric = context.numeric?.(left, right);
    meter.checkpoint();
    const result = numeric === undefined ? realDivmod(left, right, values, meter) : dispatchBinaryOperation(numeric, meter);
    meter.checkpoint();
    if (result !== values.notImplemented) return result;
    const names: string[] = [];
    meter.checkpoint(0, 48);
    for (const value of positional) {
      const name = context.typeName?.(value) ?? (value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind);
      names.push(diagnosticTypeName(name, meter, 100));
    }
    throw new PythonRuntimeError("TypeError", `unsupported operand type(s) for divmod(): '${names[0]}' and '${names[1]}'`);
  } });
}

function realDivmod(left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  if (left.kind !== "bool" && left.kind !== "int" && left.kind !== "float") return values.notImplemented;
  if (right.kind !== "bool" && right.kind !== "int" && right.kind !== "float") return values.notImplemented;
  const a = left.kind === "bool" ? (left.value ? 1n : 0n) : left.value;
  const b = right.kind === "bool" ? (right.value ? 1n : 0n) : right.value;
  let bits = 0;
  if (typeof a === "bigint") bits += integerBitMetric(a, "bit_length", meter);
  if (typeof b === "bigint") bits += integerBitMetric(b, "bit_length", meter);
  // Charge intermediate records, argument slots and bigint payloads before the
  // host arithmetic. As with other bigint kernels, host division is indivisible.
  meter.checkpoint(1 + Math.ceil(bits / 64), 128 + 4 * Math.ceil(bits / 8));
  if (typeof a === "bigint" && typeof b === "bigint") {
    const { quotient, remainder } = integerDivmod(a, b);
    return values.tuple([values.integer(quotient), values.integer(remainder)]);
  }
  const x = typeof a === "bigint" ? integerToFloat(a) : a;
  const y = typeof b === "bigint" ? integerToFloat(b) : b;
  const { quotient, remainder } = floatDivmod(x, y);
  return values.tuple([values.float(quotient), values.float(remainder)]);
}

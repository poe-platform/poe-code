import { dispatchBinaryOperation, type BinaryDispatch } from "./binary-dispatch.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { validateIndexResult, type IntegerIndexContext } from "./index-protocol.js";
import { runtimeBinary } from "./runtime-binary.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

export interface MultiplicationContext {
  /** Prepared numeric slots, excluding sequence repetition. */
  readonly numeric?: BinaryDispatch<RuntimeValue>;
  readonly integerIndex?: IntegerIndexContext<RuntimeValue>;
  typeName?(value: RuntimeValue): string;
}

/** Numeric negotiation precedes exact native sequence repetition, including
 * index conversion for empty sequences. This operation never mutates a list;
 * in-place slots and subclass storage belong to the object-operation layer. */
export function runtimeMultiplication(left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, context: MultiplicationContext = {}, augmented = false): RuntimeValue {
  meter.checkpoint();
  if (context.numeric !== undefined) {
    const result = dispatchBinaryOperation(context.numeric, meter);
    if (result !== values.notImplemented) return result;
  }
  let source = left, multiplier = right;
  if (source.kind !== "list" && source.kind !== "tuple" && source.kind !== "str" && source.kind !== "bytes") {
    source = right; multiplier = left;
  }
  if (source.kind === "list" || source.kind === "tuple" || source.kind === "str" || source.kind === "bytes") {
    let count = multiplier.kind === "int" ? multiplier.value : multiplier.kind === "bool" ? multiplier.value ? 1n : 0n : undefined;
    let index: IntegerIndexContext<RuntimeValue> | undefined;
    if (count === undefined) {
      index = context.integerIndex; meter.checkpoint();
      count = index?.integer(multiplier);
      if (count === undefined && index !== undefined) {
        const slot = index.lookupIndex(multiplier); meter.checkpoint();
        if (slot !== undefined) count = index.integer(validateIndexResult(slot(), index, meter));
      }
    }
    meter.checkpoint();
    if (count === undefined || BigInt.asIntN(64, count) !== count) {
      const name = diagnosticTypeName(context.typeName?.(multiplier) ?? index?.typeName(multiplier) ?? (multiplier.kind === "none" ? "NoneType" : multiplier.kind === "not-implemented" ? "NotImplementedType" : multiplier.kind), meter);
      if (count === undefined) throw new PythonRuntimeError("TypeError", `can't multiply sequence by non-int of type '${name}'`);
      throw new PythonRuntimeError("OverflowError", `cannot fit '${name}' into an index-sized integer`);
    }
    return runtimeBinary("*", source, values.integer(count), values, meter);
  }
  if (context.numeric === undefined) {
    const result = runtimeBinary("*", left, right, values, meter);
    if (result !== values.notImplemented) return result;
  }
  const a = diagnosticTypeName(context.typeName?.(left) ?? (left.kind === "none" ? "NoneType" : left.kind === "not-implemented" ? "NotImplementedType" : left.kind), meter, 100);
  const b = diagnosticTypeName(context.typeName?.(right) ?? (right.kind === "none" ? "NoneType" : right.kind === "not-implemented" ? "NotImplementedType" : right.kind), meter, 100);
  throw new PythonRuntimeError("TypeError", `unsupported operand type(s) for ${augmented ? "*=" : "*"}: '${a}' and '${b}'`);
}

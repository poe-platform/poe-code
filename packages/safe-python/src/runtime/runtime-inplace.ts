import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import { PythonRuntimeError } from "./error.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeAddition } from "./runtime-addition.js";
import { updateRuntimeDictionary } from "./runtime-dictionary-update.js";
import { isRuntimeSet, type RuntimeValue, type RuntimeValues } from "./runtime-values.js";

export type RuntimeInPlaceContext = Partial<Pick<ExpressionContext<RuntimeValue>, "binary" | "iterate">>;

/** Exact container in-place operations followed by ordinary binary fallback.
 * Streaming extension keeps partial progress on failure; direct self-extension
 * duplicates the original slots once. Assignment write-back is the caller's job
 * and must not roll back mutations. Optional expression capabilities connect
 * guest iteration/source hints and ordinary augmented binary fallback. Guest
 * in-place slots must run before this kernel; finalizers remain separate work.
 */
export function runtimeInPlace(operator: string, left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, context: RuntimeInPlaceContext = {}): RuntimeValue {
  meter.checkpoint();
  if (left.kind === "mappingproxy" && operator === "|") throw new PythonRuntimeError("TypeError", "'|=' is not supported by mappingproxy; use '|' instead");
  if (left.kind === "dict" && operator === "|") {
    updateRuntimeDictionary(left, right, values, meter);
    return left;
  }
  if (left.kind === "set" && isRuntimeSet(right) && operator === "&") {
    left.items.intersectKeysInPlace(right.items);
    return left;
  }
  if (left.kind === "set" && isRuntimeSet(right) && operator === "-") {
    left.items.subtractKeysInPlace(right.items);
    return left;
  }
  if (left.kind === "set" && isRuntimeSet(right) && (operator === "|" || operator === "^")) {
    left.items.mergeKeysInPlace(right.items, operator);
    return left;
  }
  if (left.kind === "list") {
    if (operator === "+") {
      return context.binary === undefined
        ? runtimeAddition(left, right, values, meter, undefined, true, undefined, context)
        : context.binary(operator, left, right, true);
    }
    if (operator === "*" && (right.kind === "int" || right.kind === "bool")) {
      const count = right.kind === "int" ? right.value : right.value ? 1n : 0n;
      left.items.repeatInPlace(count);
      return left;
    }
  }
  return context.binary === undefined ? runtimeBinary(operator, left, right, values, meter) : context.binary(operator, left, right, true);
}

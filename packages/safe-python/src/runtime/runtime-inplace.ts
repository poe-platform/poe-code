import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { runtimeBinary } from "./runtime-binary.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { updateRuntimeDictionary } from "./runtime-dictionary-update.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact list in-place operations followed by ordinary exact binary fallback.
 * Streaming extension keeps partial progress on failure; direct self-extension
 * duplicates the original slots once. Assignment write-back is the caller's job
 * and must not roll back mutations. Guest slots, length hints, unsupported-operand
 * diagnostics and finalizer behavior remain separate object-runtime work.
 */
export function runtimeInPlace(operator: string, left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  if (left.kind === "mappingproxy" && operator === "|") throw new PythonRuntimeError("TypeError", "'|=' is not supported by mappingproxy; use '|' instead");
  if (left.kind === "dict" && operator === "|") {
    updateRuntimeDictionary(left, right, values, meter);
    return left;
  }
  if (left.kind === "list") {
    if (operator === "+") {
      if (right.kind === "list") left.items.extend(right.items);
      else left.items.extendIterator(runtimeIterate(right, values, meter));
      return left;
    }
    if (operator === "*" && (right.kind === "int" || right.kind === "bool")) {
      const count = right.kind === "int" ? right.value : right.value ? 1n : 0n;
      left.items.repeatInPlace(count);
      return left;
    }
  }
  return runtimeBinary(operator, left, right, values, meter);
}

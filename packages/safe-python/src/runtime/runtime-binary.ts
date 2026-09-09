import { constantBinary } from "./constant-binary.js";
import { constantConcat } from "./constant-concat.js";
import { constantRepeat } from "./constant-repeat.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact runtime binary kernels, not guest reflected/subclass dispatch. Lists
 * always produce fresh slots; tuple operations preserve mutable member identity.
 * Matched-operation errors propagate. Unsupported operand combinations and
 * unavailable families decline with NotImplemented for the later guest layer.
 */
export function runtimeBinary(operator: string, left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  switch (operator) {
    case "+": case "-": case "*": case "/": case "//": case "%": case "**":
    case "&": case "|": case "^": case "<<": case ">>": case "@": break;
    default: throw new Error(`unsupported runtime binary operator: ${operator}`);
  }
  if (operator === "|") {
    const a = left.kind === "mappingproxy" ? left.value : left, b = right.kind === "mappingproxy" ? right.value : right;
    if (a.kind === "dict" && b.kind === "dict") {
      const result = values.dictionary(a.items.copy());
      result.items.update(b.items);
      meter.checkpoint();
      return result;
    }
    if (left.kind === "mappingproxy" || right.kind === "mappingproxy") {
      const aName = a.kind === "none" ? "NoneType" : a.kind === "not-implemented" ? "NotImplementedType" : a.kind;
      const bName = b.kind === "none" ? "NoneType" : b.kind === "not-implemented" ? "NotImplementedType" : b.kind;
      throw new PythonRuntimeError("TypeError", `unsupported operand type(s) for |: '${aName}' and '${bName}'`);
    }
  }
  if (left.kind === "mappingproxy" || right.kind === "mappingproxy") return values.notImplemented;
  if (left.kind === "cell" || right.kind === "cell" || left.kind === "type" || right.kind === "type") return values.notImplemented;
  if (left.kind === "getset_descriptor" || right.kind === "getset_descriptor") return values.notImplemented;
  if (left.kind === "list" || right.kind === "list") {
    if (operator === "+" && left.kind === "list" && right.kind === "list") return values.list(left.items.concat(right.items));
    if (operator === "*") {
      const source = left.kind === "list" ? left : right, multiplier = left.kind === "list" ? right : left;
      if (source.kind === "list" && (multiplier.kind === "int" || multiplier.kind === "bool")) {
        const count = multiplier.kind === "int" ? multiplier.value : multiplier.value ? 1n : 0n;
        return values.list(source.items.repeat(count));
      }
    }
    return values.notImplemented;
  }
  if (left.kind === "range" || left.kind === "iterator" || left.kind === "function" || left.kind === "dict" || left.kind === "builtin_function_or_method" || left.kind === "method" || right.kind === "range" || right.kind === "iterator" || right.kind === "function" || right.kind === "dict" || right.kind === "builtin_function_or_method" || right.kind === "method") return values.notImplemented;
  if (operator === "+") {
    const result = constantConcat<RuntimeValue>(left, right, values, meter);
    if (result !== values.notImplemented) return result;
  }
  if (operator === "*") {
    const result = constantRepeat<RuntimeValue>(left, right, values, meter);
    if (result !== values.notImplemented) return result;
  }
  if (left.kind === "tuple" || left.kind === "slice" || right.kind === "tuple" || right.kind === "slice") return values.notImplemented;
  return constantBinary(operator, left, right, values, meter);
}

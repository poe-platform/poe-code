import type { ConstantValues, PrimitiveConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { numericComparison } from "./numeric-comparison.js";
import { PythonRuntimeError } from "./error.js";
import { rangesEqual } from "./integer-sequence.js";
import type { RuntimeValue } from "./runtime-values.js";

type Compound = Extract<RuntimeValue, { kind: "list" | "tuple" | "slice" }>;

function length(value: Compound): number {
  return value.kind === "slice" ? 3 : value.items.length;
}

function item(value: Compound, index: number): RuntimeValue {
  if (value.kind === "list") return value.items.get(BigInt(index));
  if (value.kind === "tuple") return value.items[index];
  return index === 0 ? value.start : index === 1 ? value.stop : value.step;
}

function orderedResult(operator: string, order: number): boolean {
  switch (operator) {
    case "==": return order === 0;
    case "!=": return order !== 0;
    case "<": return order < 0;
    case ">": return order > 0;
    case "<=": return order <= 0;
    case ">=": return order >= 0;
    default: throw new Error(`unsupported constant comparison operator: ${operator}`);
  }
}

/** Exact builtin rich comparison, not guest overridden/reflected slots. Member
 * identity skips equality, but direct numeric equality does not. An explicit
 * stack supports nested mutable containers without host recursion. maxDepth is
 * an execution policy, not CPython's process-global limit; cycles consume it.
 * Logical task/continuation allocations are charged, but full heap and bigint
 * CPU accounting remain incomplete. Membership uses separate containment logic.
 */
export function runtimeComparison(operator: string, left: RuntimeValue, right: RuntimeValue, values: ConstantValues, meter: ExecutionMeter, maxDepth = 1000): Extract<PrimitiveConstant, { kind: "bool" }> {
  meter.checkpoint();
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) throw new RangeError("maximum comparison depth must be a positive safe integer");
  if (operator === "is" || operator === "is not") return values.boolean(operator === "is" ? left === right : left !== right);
  if (operator !== "==" && operator !== "!=" && operator !== "<" && operator !== ">" && operator !== "<=" && operator !== ">=") throw new Error(`unsupported constant comparison operator: ${operator}`);
  type Comparison = { operator: string; left: RuntimeValue; right: RuntimeValue; depth: number };
  meter.checkpoint(0, 64);
  const work: (Comparison | (() => void))[] = [{ operator, left, right, depth: 0 }];
  let result = false;
  while (work.length) {
    meter.checkpoint();
    const task = work.pop()!;
    if (typeof task === "function") { task(); continue; }
    const { operator: op, left: a, right: b, depth } = task;
    if (a.kind === "method" && b.kind === "method" && (op === "==" || op === "!=")) {
      const equal = a.value.function === b.value.function && a.value.instance === b.value.instance;
      result = op === "==" ? equal : !equal; continue;
    }
    if (a.kind === "dict" && b.kind === "dict" && (op === "==" || op === "!=")) {
      if (depth >= maxDepth) throw new PythonRuntimeError("RecursionError", "maximum recursion depth exceeded in comparison");
      meter.checkpoint(0, 64);
      const comparisons = a.items.compareValues(b.items);
      let first = true;
      const next = () => {
        const pair = first ? comparisons.next() : comparisons.next(result);
        first = false;
        if (pair.done) { result = op === "==" ? pair.value : !pair.value; return; }
        meter.checkpoint(0, 64);
        work.push(next, { operator: "==", left: pair.value[0], right: pair.value[1], depth: depth + 1 });
      };
      work.push(next);
      continue;
    }
    if ((a.kind === "bool" || a.kind === "int" || a.kind === "float" || a.kind === "complex") &&
        (b.kind === "bool" || b.kind === "int" || b.kind === "float" || b.kind === "complex")) {
      const numeric = numericComparison(op, a, b, values, meter);
      if (numeric.kind === "bool") { result = numeric.value; continue; }
    }
    if (a.kind === "str" && b.kind === "str") { result = orderedResult(op, a.value.compare(b.value, meter)); continue; }
    if (a.kind === "bytes" && b.kind === "bytes") { result = orderedResult(op, a.value.compare(b.value, meter)); continue; }
    if (a.kind === "range" && b.kind === "range" && (op === "==" || op === "!=")) {
      const equal = rangesEqual(a.value, b.value);
      result = op === "==" ? equal : !equal; continue;
    }
    if ((a.kind === "list" && b.kind === "list") || (a.kind === "tuple" && b.kind === "tuple") || (a.kind === "slice" && b.kind === "slice")) {
      if (depth >= maxDepth) throw new PythonRuntimeError("RecursionError", "maximum recursion depth exceeded in comparison");
      if (a.kind === "list" && (op === "==" || op === "!=") && length(a) !== length(b)) { result = op === "!="; continue; }
      meter.checkpoint(0, 64);
      let index = 0;
      const next = () => {
        while (index < length(a) && index < length(b)) {
          meter.checkpoint();
          const x = item(a, index), y = item(b, index); index++;
          if (x === y) continue;
          meter.checkpoint(0, 96);
          work.push(() => {
            if (result) { work.push(next); return; }
            if (op === "==" || op === "!=") { result = op === "!="; return; }
            meter.checkpoint(0, 64);
            work.push({ operator: op, left: x, right: y, depth: depth + 1 });
          }, { operator: "==", left: x, right: y, depth: depth + 1 });
          return;
        }
        result = orderedResult(op, length(a) - length(b));
      };
      work.push(next);
      continue;
    }
    if (op === "==" || op === "!=") { result = op === "==" ? a === b : a !== b; continue; }
    const aName = a.kind === "none" ? "NoneType" : a.kind === "not-implemented" ? "NotImplementedType" : a.kind;
    const bName = b.kind === "none" ? "NoneType" : b.kind === "not-implemented" ? "NotImplementedType" : b.kind;
    throw new PythonRuntimeError("TypeError", `'${op}' not supported between instances of '${aName}' and '${bName}'`);
  }
  return values.boolean(result);
}

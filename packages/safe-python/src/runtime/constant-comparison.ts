import type { ConstantValue, ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { numericComparison } from "./numeric-comparison.js";
import { PythonRuntimeError } from "./error.js";

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

/** Complete comparisons for exact builtin constant values only, not user objects
 * or subclasses. Tuple member identity skips equality, but direct numeric equality
 * does not. An explicit work stack avoids host recursion for nested tuples. Stack
 * allocation accounting and size-dependent bigint CPU charges remain unfinished.
 * Membership belongs to containment protocols, not this operation.
 */
export function constantComparison(operator: string, left: ConstantValue, right: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (operator === "is" || operator === "is not") return values.boolean(operator === "is" ? left === right : left !== right);
  if (operator !== "==" && operator !== "!=" && operator !== "<" && operator !== ">" && operator !== "<=" && operator !== ">=") throw new Error(`unsupported constant comparison operator: ${operator}`);
  type Comparison = { operator: string; left: ConstantValue; right: ConstantValue };
  const work: (Comparison | (() => void))[] = [{ operator, left, right }];
  let result = false;
  while (work.length) {
    meter.checkpoint();
    const task = work.pop()!;
    if (typeof task === "function") { task(); continue; }
    const { operator: op, left: a, right: b } = task;
    if (a.kind === "bool" || a.kind === "int" || a.kind === "float" || a.kind === "complex") {
      const numeric = numericComparison(op, a, b, values, meter);
      if (numeric.kind === "bool") { result = numeric.value; continue; }
    }
    if (a.kind === "str" && b.kind === "str") { result = orderedResult(op, a.value.compare(b.value, meter)); continue; }
    if (a.kind === "bytes" && b.kind === "bytes") { result = orderedResult(op, a.value.compare(b.value, meter)); continue; }
    if ((a.kind === "tuple" && b.kind === "tuple") || (a.kind === "slice" && b.kind === "slice")) {
      // Slice comparison uses the same identity-aware component ordering as
      // tuples; charge temporary three-reference arrays, not guest tuple records.
      if (a.kind === "slice") meter.checkpoint(0, 6 * 8);
      const aItems = a.kind === "tuple" ? a.items : [a.start, a.stop, a.step];
      const bItems = b.kind === "tuple" ? b.items : [b.start, b.stop, b.step];
      let index = 0;
      const next = () => {
        while (index < aItems.length && index < bItems.length) {
          meter.checkpoint();
          const x = aItems[index], y = bItems[index]; index++;
          if (x === y) continue;
          work.push(() => {
            if (result) { work.push(next); return; }
            if (op === "==" || op === "!=") { result = op === "!="; return; }
            work.push({ operator: op, left: x, right: y });
          }, { operator: "==", left: x, right: y });
          return;
        }
        result = orderedResult(op, aItems.length - bItems.length);
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

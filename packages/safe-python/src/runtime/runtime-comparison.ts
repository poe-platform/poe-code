import type { ConstantValues, PrimitiveConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { numericComparison } from "./numeric-comparison.js";
import { PythonRuntimeError } from "./error.js";
import { rangesEqual } from "./integer-sequence.js";
import { isRuntimeSet, type BuiltinInvocationContext, type RuntimeValue } from "./runtime-values.js";
import { compareRuntimeDictionaryViews } from "./runtime-dictionary-view.js";
import { runtimeTruth } from "./runtime-truth.js";

export interface RuntimeComparisonContext extends Pick<BuiltinInvocationContext, "isException"> {
  /** Return NotImplemented for unsupported root pairs so an outer dispatcher
   * can try guest reflection. Delegated/member comparisons still resolve fully.
   * This is a combined native-kernel boundary, not an exposed single-type slot. */
  readonly declineUnsupported?: boolean;
  /** Prepared guest slots for any delegated comparison. When supplied, this
   * replaces the specialized equality/ordering callbacks below. */
  comparison?(operator: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue | undefined;
  /** Undefined delegates to the native comparison stack, not recursive dispatch.
   * A supplied result comes from prepared guest equality slots. */
  equality?(left: RuntimeValue, right: RuntimeValue): RuntimeValue | undefined;
  /** Lexicographic ordering returns the guest result without truth conversion. */
  ordering?(operator: string, left: RuntimeValue, right: RuntimeValue): RuntimeValue | undefined;
  truth?(value: RuntimeValue): boolean;
}

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
export function runtimeComparison(operator: string, left: RuntimeValue, right: RuntimeValue, values: ConstantValues, meter: ExecutionMeter, maxDepth?: number): Extract<PrimitiveConstant, { kind: "bool" }>;
export function runtimeComparison(operator: string, left: RuntimeValue, right: RuntimeValue, values: ConstantValues, meter: ExecutionMeter, maxDepth: number, context: RuntimeComparisonContext | undefined): RuntimeValue;
export function runtimeComparison(operator: string, left: RuntimeValue, right: RuntimeValue, values: ConstantValues, meter: ExecutionMeter, maxDepth = 1000, context?: RuntimeComparisonContext): RuntimeValue {
  meter.checkpoint();
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) throw new RangeError("maximum comparison depth must be a positive safe integer");
  if (operator === "is" || operator === "is not") return values.boolean(operator === "is" ? left === right : left !== right);
  if (operator !== "==" && operator !== "!=" && operator !== "<" && operator !== ">" && operator !== "<=" && operator !== ">=") throw new Error(`unsupported constant comparison operator: ${operator}`);
  type Comparison = { operator: string; left: RuntimeValue; right: RuntimeValue; depth: number; truth?: boolean };
  meter.checkpoint(0, 64);
  const work: (Comparison | (() => void))[] = [{ operator, left, right, depth: 0 }];
  let result = false;
  while (work.length) {
    meter.checkpoint();
    const task = work.pop()!;
    if (typeof task === "function") { task(); continue; }
    const { operator: op, left: a, right: b, depth, truth } = task;
    if (depth > 0 && context !== undefined) {
      if (depth >= maxDepth) throw new PythonRuntimeError("RecursionError", "maximum recursion depth exceeded in comparison");
      const guest = context.comparison !== undefined ? context.comparison(op, a, b)
        : op === "==" ? context.equality?.(a, b) : op === "!=" ? undefined : context.ordering?.(op, a, b);
      meter.checkpoint();
      if (guest !== undefined) {
        // Only container probes consume truth. Cell/proxy delegation preserves
        // the caller's result mode, including raw equality/inequality results.
        if (!truth) return guest;
        result = context.truth === undefined ? runtimeTruth(guest, meter) : context.truth(guest);
        meter.checkpoint(); continue;
      }
    }
    if (isRuntimeSet(a) && isRuntimeSet(b)) {
      const aSize = a.items.size, bSize = b.items.size;
      if (op === "==" || op === "!=") {
        const equal = a.items.hasEqualKeys(b.items);
        result = op === "==" ? equal : !equal;
      } else if (op === "<" || op === "<=") result = (op === "<" ? aSize < bSize : aSize <= bSize) && a.items.isKeySubsetOf(b.items);
      else result = (op === ">" ? aSize > bSize : aSize >= bSize) && b.items.isKeySubsetOf(a.items);
      continue;
    }
    if ((a.kind === "dict_keys" || a.kind === "dict_items" || isRuntimeSet(a)) && (b.kind === "dict_keys" || b.kind === "dict_items" || isRuntimeSet(b))) {
      if (depth >= maxDepth) throw new PythonRuntimeError("RecursionError", "maximum recursion depth exceeded in comparison");
      meter.checkpoint(0, 64);
      const comparisons = compareRuntimeDictionaryViews(op, a, b, values, meter, context);
      let first = true;
      const next = () => {
        const pair = first ? comparisons.next() : comparisons.next(result);
        first = false;
        if (pair.done) { result = pair.value; return; }
        meter.checkpoint(0, 64);
        work.push(next, { operator: "==", left: pair.value[0], right: pair.value[1], depth: depth + 1, truth: true });
      };
      work.push(next);
      continue;
    }
    if (a.kind === "mappingproxy" || b.kind === "mappingproxy") {
      if (depth >= maxDepth) throw new PythonRuntimeError("RecursionError", "maximum recursion depth exceeded in comparison");
      meter.checkpoint(0, 64);
      if (a.kind === "mappingproxy") work.push({ operator: op, left: a.value, right: b, depth: depth + 1, truth });
      else if (b.kind === "mappingproxy") {
        const reflected = op === "<" ? ">" : op === ">" ? "<" : op === "<=" ? ">=" : op === ">=" ? "<=" : op;
        work.push({ operator: reflected, left: b.value, right: a, depth: depth + 1, truth });
      }
      continue;
    }
    if (a.kind === "cell" && b.kind === "cell") {
      if (depth >= maxDepth) throw new PythonRuntimeError("RecursionError", "maximum recursion depth exceeded in comparison");
      const x = a.value.content, y = b.value.content;
      if (x === undefined || y === undefined) {
        result = orderedResult(op, Number(x !== undefined) - Number(y !== undefined));
        continue;
      }
      // Cell rich comparison delegates the requested operator directly, even
      // for identical contents (unlike container member equality shortcuts).
      meter.checkpoint(0, 64);
      work.push({ operator: op, left: x.value, right: y.value, depth: depth + 1, truth });
      continue;
    }
    if (a.kind === "method" && b.kind === "method" && (op === "==" || op === "!=")) {
      if (a.value.function === b.value.function) {
        const equal = a.value.instance === b.value.instance;
        result = op === "==" ? equal : !equal; continue;
      }
      if (depth >= maxDepth) throw new PythonRuntimeError("RecursionError", "maximum recursion depth exceeded in comparison");
      meter.checkpoint(0, 96);
      work.push(() => { const equal = result && a.value.instance === b.value.instance; result = op === "==" ? equal : !equal; },
        { operator: "==", left: a.value.function, right: b.value.function, depth: depth + 1, truth: true });
      continue;
    }
    if (a.kind === "method-wrapper" && b.kind === "method-wrapper" && (op === "==" || op === "!=")) {
      const equal = a.value.descriptor === b.value.descriptor && a.value.instance === b.value.instance;
      result = op === "==" ? equal : !equal; continue;
    }
    if (a.kind === "builtin_function_or_method" && b.kind === "builtin_function_or_method" && (op === "==" || op === "!=")) {
      const equal = a === b || (a.binding !== undefined && b.binding !== undefined && a.binding.implementation === b.binding.implementation && a.binding.instance === b.binding.instance);
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
        work.push(next, { operator: "==", left: pair.value[0], right: pair.value[1], depth: depth + 1, truth: true });
      };
      work.push(next);
      continue;
    }
    if ((a.kind === "bool" || a.kind === "int" || a.kind === "float" || a.kind === "complex") &&
        (b.kind === "bool" || b.kind === "int" || b.kind === "float" || b.kind === "complex")) {
      const numeric = numericComparison(op, a, b, values, meter);
      if (numeric.kind === "bool") { result = numeric.value; continue; }
    }
    if (a.kind === "str" && b.kind === "str") {
      if (op === "==" || op === "!=") result = a.value.equals(b.value, meter) === (op === "==");
      else result = orderedResult(op, a.value.compare(b.value, meter));
      continue;
    }
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
            // Equality callbacks may replace elements or shrink either list.
            // CPython checks the current sizes before using the unequal pair.
            const comparedIndex = index - 1;
            if (comparedIndex >= length(a) || comparedIndex >= length(b)) {
              result = orderedResult(op, length(a) - length(b)); return;
            }
            if (op === "==" || op === "!=") { result = op === "!="; return; }
            meter.checkpoint(0, 64);
            work.push({ operator: op, left: item(a, comparedIndex), right: item(b, comparedIndex), depth: depth + 1, truth });
          }, { operator: "==", left: x, right: y, depth: depth + 1, truth: true });
          return;
        }
        result = orderedResult(op, length(a) - length(b));
      };
      work.push(next);
      continue;
    }
    if (depth === 0) {
      const decline = context?.declineUnsupported; meter.checkpoint();
      if (decline && (a !== b || op !== "==" && op !== "!=")) return values.notImplemented;
    }
    if (op === "==" || op === "!=") { result = op === "==" ? a === b : a !== b; continue; }
    const aName = a.kind === "none" ? "NoneType" : a.kind === "not-implemented" ? "NotImplementedType" : a.kind;
    const bName = b.kind === "none" ? "NoneType" : b.kind === "not-implemented" ? "NotImplementedType" : b.kind;
    throw new PythonRuntimeError("TypeError", `'${op}' not supported between instances of '${aName}' and '${bName}'`);
  }
  return values.boolean(result);
}

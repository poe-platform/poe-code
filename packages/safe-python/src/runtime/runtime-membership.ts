import type { ConstantValues, PrimitiveConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { PythonRuntimeError } from "./error.js";
import { rangeIndexOf } from "./integer-sequence.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { RuntimeValue } from "./runtime-values.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { containsRuntimeDictionaryView } from "./runtime-dictionary-view.js";

/** Exact runtime membership. Integer/bool range searches use arithmetic; other
 * iterable searches consume only through the first identity/equality match.
 * User __contains__/iteration slots, arbitrary buffer exporters and a shared
 * guest comparison-depth policy remain wider object-runtime responsibilities.
 */
export function runtimeMembership(operator: string, needle: RuntimeValue, container: RuntimeValue, values: ConstantValues, meter: ExecutionMeter): Extract<PrimitiveConstant, { kind: "bool" }> {
  meter.checkpoint();
  if (operator !== "in" && operator !== "not in") throw new Error(`unsupported constant membership operator: ${operator}`);
  let found = false;
  if (container.kind === "dict_keys" || container.kind === "dict_values" || container.kind === "dict_items") {
    const comparisons = containsRuntimeDictionaryView(container, needle, meter);
    let item = comparisons.next();
    while (!item.done) {
      meter.checkpoint();
      item = comparisons.next(runtimeComparison("==", item.value[0], item.value[1], values, meter).value);
    }
    found = item.value;
  } else if (container.kind === "dict" || container.kind === "mappingproxy") {
    found = runtimeDictionaryAccess(container.kind === "dict" ? container : container.value, needle, "contains", meter);
  } else if (container.kind === "range" && (needle.kind === "int" || needle.kind === "bool")) {
    const integer = needle.kind === "int" ? needle.value : needle.value ? 1n : 0n;
    found = rangeIndexOf(container.value, integer) !== undefined;
  } else if (container.kind === "tuple" || container.kind === "list" || container.kind === "iterator" || container.kind === "range") {
    const iterator = runtimeIterate(container, values, meter);
    while (true) {
      meter.checkpoint();
      const item = iterator.next();
      meter.checkpoint();
      if (item.done) break;
      const member = item.value;
      if (member === needle || runtimeComparison("==", member, needle, values, meter) === values.true) { found = true; break; }
    }
  } else if (container.kind === "str") {
    if (needle.kind !== "str") {
      const name = needle.kind === "none" ? "NoneType" : needle.kind === "not-implemented" ? "NotImplementedType" : needle.kind;
      throw new PythonRuntimeError("TypeError", `'in <string>' requires string as left operand, not ${name}`);
    }
    found = container.value.search(needle.value, "find", 0n, null, meter) !== -1;
  } else if (container.kind === "bytes") {
    if (needle.kind === "bytes") found = container.value.contains(needle.value, meter);
    else if (needle.kind === "int" || needle.kind === "bool") {
      const integer = needle.kind === "int" ? needle.value : needle.value ? 1n : 0n;
      if (integer < 0n || integer > 255n) throw new PythonRuntimeError("ValueError", "byte must be in range(0, 256)");
      found = container.value.contains(Number(integer), meter);
    } else {
      const name = needle.kind === "none" ? "NoneType" : needle.kind === "not-implemented" ? "NotImplementedType" : needle.kind;
      throw new PythonRuntimeError("TypeError", `a bytes-like object is required, not '${name}'`);
    }
  } else {
    const name = container.kind === "none" ? "NoneType" : container.kind === "not-implemented" ? "NotImplementedType" : container.kind;
    throw new PythonRuntimeError("TypeError", `argument of type '${name}' is not a container or iterable`);
  }
  return values.boolean(operator === "in" ? found : !found);
}

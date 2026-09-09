import type { ConstantValue, ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { constantComparison } from "./constant-comparison.js";
import { PythonRuntimeError } from "./error.js";

/** Membership for exact immutable builtin values. User __contains__, iteration
 * fallback, index conversion and arbitrary buffer exporters belong to the wider
 * guest object runtime, not this constant-only operation.
 */
export function constantMembership(operator: string, needle: ConstantValue, container: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (operator !== "in" && operator !== "not in") throw new Error(`unsupported constant membership operator: ${operator}`);
  let found = false;
  if (container.kind === "tuple") {
    for (const member of container.items) {
      meter.checkpoint();
      if (member === needle || constantComparison("==", member, needle, values, meter) === values.true) { found = true; break; }
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

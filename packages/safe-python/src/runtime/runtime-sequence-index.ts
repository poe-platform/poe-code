import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { validateIndexResult, type IntegerIndexContext } from "./index-protocol.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Shared subscription conversion for sequence reads and writes. Mapping keys
 * never pass through this operation; ranges retain arbitrary precision. */
export function runtimeSequenceIndex(kind: "list" | "tuple" | "str" | "bytes" | "range", key: RuntimeValue, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>): bigint {
  meter.checkpoint();
  let index = key.kind === "int" ? key.value : key.kind === "bool" ? (key.value ? 1n : 0n) : context?.integer(key);
  if (index === undefined && context !== undefined) {
    const slot = context.lookupIndex(key);
    meter.checkpoint();
    if (slot !== undefined) index = context.integer(validateIndexResult(slot(), context, meter));
  }
  meter.checkpoint();
  if (index === undefined) {
    const name = context === undefined ? key.kind === "none" ? "NoneType" : key.kind === "not-implemented" ? "NotImplementedType" : key.kind : diagnosticTypeName(context.typeName(key), meter);
    throw new PythonRuntimeError("TypeError", kind === "str" ? `string indices must be integers, not '${name}'` : `${kind === "bytes" ? "byte" : kind} indices must be integers or slices, not ${name}`);
  }
  if (kind !== "range" && BigInt.asIntN(64, index) !== index) {
    const name = key.kind === "int" ? "int" : context === undefined ? key.kind : diagnosticTypeName(context.typeName(key), meter);
    throw new PythonRuntimeError("IndexError", `cannot fit '${name}' into an index-sized integer`);
  }
  return index;
}

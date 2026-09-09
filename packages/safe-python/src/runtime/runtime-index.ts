import { constantIndex } from "./constant-index.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { normalizeSlice, rangeItem, sliceRange } from "./integer-sequence.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { runtimeSliceBounds } from "./runtime-slice-bounds.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { validateIndexResult, type IntegerIndexContext } from "./index-protocol.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";

/** Exact builtin subscription with optional guest index conversion. __getitem__ and overridden
 * subclass slots require the separate object protocol layer. List slices adopt
 * fresh owned slots, retaining member identity; ranges remain lazy progressions.
 */
export function runtimeIndex(object: RuntimeValue, key: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>): RuntimeValue {
  meter.checkpoint();
  if (object.kind === "dict") return runtimeDictionaryAccess(object, key, "get", meter);
  if (object.kind === "mappingproxy") return runtimeDictionaryAccess(object.value, key, "get", meter);
  if (object.kind !== "list" && object.kind !== "range" && object.kind !== "tuple" && object.kind !== "str" && object.kind !== "bytes") {
    const name = object.kind === "none" ? "NoneType" : object.kind === "not-implemented" ? "NotImplementedType" : object.kind;
    throw new PythonRuntimeError("TypeError", `'${name}' object is not subscriptable`);
  }
  if (key.kind === "slice") {
    const { start, stop, step } = runtimeSliceBounds(key, meter);
    switch (object.kind) {
      case "list": return values.list(object.items.slice(start, stop, step));
      case "range":
        meter.checkpoint(1, 64);
        return values.range(sliceRange(object.value, start, stop, step));
      case "str":
      case "bytes":
      case "tuple": {
        const length = object.kind === "tuple" ? object.items.length : object.value.length;
        const indices = normalizeSlice(BigInt(length), start, stop, step);
        if (indices.step === 1n && indices.start === 0n && indices.length === BigInt(length) && (object.kind !== "bytes" || length !== 0)) return object;
        if (object.kind === "str") return values.stringPoints(object.value.slice(start, stop, step, meter), indices.step === 1n ? "canonical" : "fresh");
        if (object.kind === "bytes") return values.bytes(object.value.slice(start, stop, step, meter), indices.step === 1n || indices.length === 0n ? "canonical" : "fresh");
        const count = Number(indices.length), first = Number(indices.start), stride = count > 1 ? Number(indices.step) : 0;
        return values.tuple(count, offset => object.items[first + offset * stride]);
      }
    }
  }
  let index = key.kind === "int" ? key.value : key.kind === "bool" ? (key.value ? 1n : 0n) : context?.integer(key);
  if (index === undefined && context !== undefined) {
    const slot = context.lookupIndex(key);
    meter.checkpoint();
    if (slot !== undefined) index = context.integer(validateIndexResult(slot(), context, meter));
  }
  meter.checkpoint();
  if (index === undefined) {
    const name = context === undefined ? key.kind === "none" ? "NoneType" : key.kind === "not-implemented" ? "NotImplementedType" : key.kind : diagnosticTypeName(context.typeName(key), meter);
    throw new PythonRuntimeError("TypeError", object.kind === "str" ? `string indices must be integers, not '${name}'` : `${object.kind === "bytes" ? "byte" : object.kind} indices must be integers or slices, not ${name}`);
  }
  if (object.kind !== "range" && BigInt.asIntN(64, index) !== index) {
    const name = key.kind === "int" ? "int" : context === undefined ? key.kind : diagnosticTypeName(context.typeName(key), meter);
    throw new PythonRuntimeError("IndexError", `cannot fit '${name}' into an index-sized integer`);
  }
  if (object.kind === "list") return object.items.get(index);
  if (object.kind === "range") return values.integer(rangeItem(object.value, index));
  if (object.kind === "str" || object.kind === "bytes") return constantIndex(object, key.kind === "int" || key.kind === "bool" ? key : values.integer(index), values, meter);
  if (index < 0n) index += BigInt(object.items.length);
  if (index < 0n || index >= BigInt(object.items.length)) throw new PythonRuntimeError("IndexError", "tuple index out of range");
  return object.items[Number(index)];
}

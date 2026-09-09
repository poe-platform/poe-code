import { constantIndex } from "./constant-index.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { normalizeSlice, rangeItem, sliceRange } from "./integer-sequence.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

function bound(value: RuntimeValue, meter: ExecutionMeter): bigint | null {
  meter.checkpoint();
  if (value.kind === "none") return null;
  if (value.kind === "int") return value.value;
  if (value.kind === "bool") return value.value ? 1n : 0n;
  throw new PythonRuntimeError("TypeError", "slice indices must be integers or None or have an __index__ method");
}

/** Exact builtin subscription. Guest __index__/__getitem__ and overridden
 * subclass slots require the separate object protocol layer. List slices adopt
 * fresh owned slots, retaining member identity; ranges remain lazy progressions.
 */
export function runtimeIndex(object: RuntimeValue, key: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  if (object.kind !== "list" && object.kind !== "range" && object.kind !== "tuple" && object.kind !== "str" && object.kind !== "bytes") {
    const name = object.kind === "none" ? "NoneType" : object.kind === "not-implemented" ? "NotImplementedType" : object.kind;
    throw new PythonRuntimeError("TypeError", `'${name}' object is not subscriptable`);
  }
  if (key.kind === "slice") {
    const step = bound(key.step, meter);
    if (step === 0n) throw new PythonRuntimeError("ValueError", "slice step cannot be zero");
    const start = bound(key.start, meter), stop = bound(key.stop, meter);
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
        if (indices.step === 1n && indices.start === 0n && indices.length === BigInt(length)) return object;
        if (object.kind === "str") return values.stringPoints(object.value.slice(start, stop, step, meter));
        if (object.kind === "bytes") return values.bytes(object.value.slice(start, stop, step, meter));
        const count = Number(indices.length), first = Number(indices.start), stride = count > 1 ? Number(indices.step) : 0;
        return values.tuple(count, offset => object.items[first + offset * stride]);
      }
    }
  }
  if (key.kind !== "int" && key.kind !== "bool") {
    const name = key.kind === "none" ? "NoneType" : key.kind === "not-implemented" ? "NotImplementedType" : key.kind;
    throw new PythonRuntimeError("TypeError", object.kind === "str" ? `string indices must be integers, not '${name}'` : `${object.kind === "bytes" ? "byte" : object.kind} indices must be integers or slices, not ${name}`);
  }
  let index = key.kind === "int" ? key.value : key.value ? 1n : 0n;
  if (object.kind === "list") return object.items.get(index);
  if (object.kind === "range") return values.integer(rangeItem(object.value, index));
  if (object.kind === "str" || object.kind === "bytes") return constantIndex(object, key, values, meter);
  if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("IndexError", "cannot fit 'int' into an index-sized integer");
  if (index < 0n) index += BigInt(object.items.length);
  if (index < 0n || index >= BigInt(object.items.length)) throw new PythonRuntimeError("IndexError", "tuple index out of range");
  return object.items[Number(index)];
}

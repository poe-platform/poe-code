import type { ConstantValue, ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { constantSlice } from "./constant-slice.js";

/** Integer and slice subscription for exact immutable builtin values. Guest
 * __index__/__getitem__ dispatch belongs to separate object-runtime operations.
 * String results preserve a single Unicode code point, including surrogates;
 * tuple results retain the original member identity.
 */
export function constantIndex(object: ConstantValue, key: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (object.kind !== "str" && object.kind !== "bytes" && object.kind !== "tuple") {
    const name = object.kind === "none" ? "NoneType" : object.kind === "not-implemented" ? "NotImplementedType" : object.kind;
    throw new PythonRuntimeError("TypeError", `'${name}' object is not subscriptable`);
  }
  if (key.kind === "slice") return constantSlice(object, { lower: key.start, upper: key.stop, step: key.step }, values, meter);
  if (key.kind !== "int" && key.kind !== "bool") {
    const name = key.kind === "none" ? "NoneType" : key.kind === "not-implemented" ? "NotImplementedType" : key.kind;
    throw new PythonRuntimeError("TypeError", object.kind === "str" ? `string indices must be integers, not '${name}'` : `${object.kind === "bytes" ? "byte" : "tuple"} indices must be integers or slices, not ${name}`);
  }
  let index = key.kind === "int" ? key.value : key.value ? 1n : 0n;
  if (object.kind === "bytes") return values.integer(object.value.byteAt(index, meter));
  if (object.kind === "str") {
    const point = object.value.codePointAt(index, meter);
    meter.checkpoint(0, Uint32Array.BYTES_PER_ELEMENT);
    return values.stringPoints(Uint32Array.of(point), "canonical");
  }
  if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("IndexError", "cannot fit 'int' into an index-sized integer");
  if (index < 0n) index += BigInt(object.items.length);
  if (index < 0n || index >= BigInt(object.items.length)) throw new PythonRuntimeError("IndexError", "tuple index out of range");
  return object.items[Number(index)];
}

import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { runtimeSizeIndex } from "./runtime-size-index.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeIntegerToBytesMethod(receiver: Extract<RuntimeValue, { kind: "int" | "bool" }>, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "to_bytes",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (count > 3) throw new PythonRuntimeError("TypeError", `to_bytes() takes at most 3 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `to_bytes() takes at most 2 positional arguments (${positional.length} given)`);
      let lengthArgument = positional[0], orderArgument = positional[1], signedArgument: RuntimeValue = values.false;
      for (const [key, value] of keywords.items.snapshot()) {
        if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        if (label !== "length" && label !== "byteorder" && label !== "signed") throw new PythonRuntimeError("TypeError", `to_bytes() got an unexpected keyword argument '${label}'`);
        const position = label === "length" ? 1 : label === "byteorder" ? 2 : 3;
        if (positional.length >= position) throw new PythonRuntimeError("TypeError", `argument for to_bytes() given by name ('${label}') and position (${position})`);
        if (label === "length") lengthArgument = value; else if (label === "byteorder") orderArgument = value; else signedArgument = value;
      }
      const length = lengthArgument === undefined ? 1n : runtimeSizeIndex(lengthArgument, meter);
      if (orderArgument !== undefined && orderArgument.kind !== "str") {
        const type = orderArgument.kind === "none" ? "None" : orderArgument.kind === "not-implemented" ? "NotImplementedType" : orderArgument.kind;
        throw new PythonRuntimeError("TypeError", `to_bytes() argument 'byteorder' must be str, not ${type}`);
      }
      const signed = runtimeTruth(signedArgument, meter);
      let order = "big";
      if (orderArgument !== undefined) {
        order = "";
        if (orderArgument.value.length === 3 || orderArgument.value.length === 6) for (const point of orderArgument.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); order += String.fromCodePoint(point); }
      }
      if (order !== "big" && order !== "little") throw new PythonRuntimeError("ValueError", "byteorder must be either 'little' or 'big'");
      const value = receiver.kind === "int" ? receiver.value : receiver.value ? 1n : 0n;
      return values.bytes(ImmutableBytes.fromInteger(value, length, order === "little", signed, meter), length === 0n ? "canonical" : "fresh");
    }
  });
}

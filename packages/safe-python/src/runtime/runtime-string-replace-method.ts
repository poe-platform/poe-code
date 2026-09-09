import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeStringReplaceMethod(receiver: Extract<RuntimeValue, { kind: "str" }>, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "replace",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const total = positional.length + keywords.items.size;
      if (total > 3) throw new PythonRuntimeError("TypeError", `replace() takes at most 3 ${positional.length === 0 ? "keyword " : ""}arguments (${total} given)`);
      if (positional.length < 2) throw new PythonRuntimeError("TypeError", `replace() takes at least 2 positional arguments (${positional.length} given)`);
      let limit = positional[2];
      for (const [key, value] of keywords.items.snapshot()) {
        if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        if (label !== "count") throw new PythonRuntimeError("TypeError", `replace() got an unexpected keyword argument '${label}'`);
        limit = value;
      }
      const old = replacementStringArgument(positional[0], 1), replacement = replacementStringArgument(positional[1], 2);
      let count = -1n;
      if (limit !== undefined) {
        if (limit.kind === "bool") count = limit.value ? 1n : 0n;
        else if (limit.kind === "int") count = limit.value;
        else {
          const type = limit.kind === "none" ? "NoneType" : limit.kind === "not-implemented" ? "NotImplementedType" : limit.kind;
          throw new PythonRuntimeError("TypeError", `'${type}' object cannot be interpreted as an integer`);
        }
        if (BigInt.asIntN(64, count) !== count) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
      }
      if (old === replacement) return receiver;
      const result = receiver.value.replace(old.value, replacement.value, count, meter);
      return result === receiver.value ? receiver : values.stringPoints(result);
    }
  });
}

function replacementStringArgument(value: RuntimeValue, position: number): Extract<RuntimeValue, { kind: "str" }> {
  if (value.kind === "str") return value;
  const type = value.kind === "none" ? "None" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
  throw new PythonRuntimeError("TypeError", `replace() argument ${position} must be str, not ${type}`);
}

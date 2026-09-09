import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeBytesTranslateMethod(receiver: Extract<RuntimeValue, { kind: "bytes" }>, values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "translate",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (count > 2) throw new PythonRuntimeError("TypeError", `translate() takes at most 2 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "translate() takes at least 1 positional argument (0 given)");
      let deleted = positional[1];
      for (const [key, value] of keywords.items.snapshot()) {
        if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        if (label !== "delete") throw new PythonRuntimeError("TypeError", `translate() got an unexpected keyword argument '${label}'`);
        deleted = value;
      }
      const table = positional[0].kind === "none" ? null : translationBytesArgument(positional[0]).value;
      if (table !== null && table.length !== 256) throw new PythonRuntimeError("ValueError", "translation table must be 256 characters long");
      const deletion = deleted === undefined ? null : translationBytesArgument(deleted).value;
      const result = receiver.value.translate(table, deletion, meter);
      return result === receiver.value ? receiver : values.bytes(result, result.length === 0 ? "canonical" : "fresh");
    }
  });
}

function translationBytesArgument(value: RuntimeValue): Extract<RuntimeValue, { kind: "bytes" }> {
  if (value.kind === "bytes") return value;
  const type = value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
  throw new PythonRuntimeError("TypeError", `a bytes-like object is required, not '${type}'`);
}

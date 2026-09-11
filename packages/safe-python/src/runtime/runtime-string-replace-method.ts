import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeSizeIndex } from "./runtime-size-index.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

export function createRuntimeStringReplaceMethod(original: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, context?: IntegerIndexContext<RuntimeValue>): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const receiver = runtimeStringPayload(original);
  if (receiver === undefined) throw Error("replacement requires native string storage");
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
      const old = replacementStringArgument(positional[0], 1, meter), replacement = replacementStringArgument(positional[1], 2, meter);
      const count = limit === undefined ? -1n : runtimeSizeIndex(limit, meter, context);
      const result = old === replacement ? receiver.value : receiver.value.replace(old.value, replacement.value, count, meter);
      return original === receiver && result === receiver.value ? receiver : values.stringPoints(result);
    }
  });
}

function replacementStringArgument(value: RuntimeValue, position: number, meter: ExecutionMeter): Extract<RuntimeValue, { kind: "str" }> {
  const payload = runtimeStringPayload(value);
  if (payload !== undefined) return payload;
  const type = diagnosticTypeName(value.kind === "none" ? "None" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind === "instance" ? value.type.value.diagnosticName : value.kind, meter, 50);
  throw new PythonRuntimeError("TypeError", `replace() argument ${position} must be str, not ${type}`);
}

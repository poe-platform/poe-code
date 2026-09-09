import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeBytesInput, type RuntimeBytesInputContext } from "./runtime-bytes-input.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import type { ExpressionContext } from "./expression-evaluation.js";

export interface RuntimeIntegerFromBytesContext extends RuntimeBytesInputContext {
  readonly truth?: ExpressionContext<RuntimeValue>["truth"];
}

export function createRuntimeIntegerFromBytesMethod(booleanClass: boolean, values: RuntimeValues, meter: ExecutionMeter, context: RuntimeIntegerFromBytesContext = {}): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "from_bytes",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      const count = positional.length + keywords.items.size;
      if (count > 3) throw new PythonRuntimeError("TypeError", `from_bytes() takes at most 3 ${positional.length === 0 ? "keyword " : ""}arguments (${count} given)`);
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `from_bytes() takes at most 2 positional arguments (${positional.length} given)`);
      let source = positional[0], orderArgument = positional[1], signedArgument: RuntimeValue = values.false, unexpected: string | undefined;
      for (const [key, value] of keywords.items.snapshot()) {
        if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
        let label = "";
        for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        if (label !== "bytes" && label !== "byteorder" && label !== "signed") { unexpected ??= label; continue; }
        const position = label === "bytes" ? 1 : label === "byteorder" ? 2 : 3;
        if (positional.length >= position) throw new PythonRuntimeError("TypeError", `argument for from_bytes() given by name ('${label}') and position (${position})`);
        if (label === "bytes") source = value; else if (label === "byteorder") orderArgument = value; else signedArgument = value;
      }
      if (source === undefined) throw new PythonRuntimeError("TypeError", "from_bytes() missing required argument 'bytes' (pos 1)");
      if (unexpected !== undefined) throw new PythonRuntimeError("TypeError", `from_bytes() got an unexpected keyword argument '${unexpected}'`);
      if (orderArgument !== undefined && orderArgument.kind !== "str") {
        const type = orderArgument.kind === "none" ? "None" : orderArgument.kind === "not-implemented" ? "NotImplementedType" : orderArgument.kind;
        throw new PythonRuntimeError("TypeError", `from_bytes() argument 'byteorder' must be str, not ${type}`);
      }
      const signed = context.truth === undefined ? runtimeTruth(signedArgument, meter) : context.truth(signedArgument);
      meter.checkpoint();
      let order = "big";
      if (orderArgument !== undefined) {
        order = "";
        if (orderArgument.value.length === 3 || orderArgument.value.length === 6) for (const point of orderArgument.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); order += String.fromCodePoint(point); }
      }
      if (order !== "big" && order !== "little") throw new PythonRuntimeError("ValueError", "byteorder must be either 'little' or 'big'");
      const result = runtimeBytesInput(source, values, meter, context).toInteger(order === "little", signed, meter);
      return booleanClass ? values.boolean(result !== 0n) : values.integer(result);
    }
  });
}

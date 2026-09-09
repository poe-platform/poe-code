import { braceFormat } from "./brace-format.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import type { FormatContext } from "./format-protocol.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Public native methods with explicit lookup and formatting capabilities. */
export function createRuntimeBraceFormatMethod(receiver: Extract<RuntimeValue, { kind: "str" }>, name: "format" | "format_map", values: RuntimeValues, meter: ExecutionMeter, formatting: FormatContext<RuntimeValue>, lookup: Pick<ExpressionContext<RuntimeValue>, "attribute" | "getItem">): BuiltinFunctionValue {
  meter.checkpoint(1, 128);
  return values.builtinFunction({ name, invoke(positional, keywords, meter) {
    meter.checkpoint();
    if (name === "format_map") {
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "str.format_map() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `str.format_map() takes exactly one argument (${positional.length} given)`);
    }
    const result = braceFormat(receiver.value, name === "format_map" ? null : positional, {
      keyword(key) {
        const value = values.stringPoints(key);
        return name === "format_map" ? lookup.getItem(positional[0], value) : runtimeDictionaryAccess(keywords, value, "get", meter);
      },
      attribute(value, key) {
        let label = "";
        for (const point of key) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
        return lookup.attribute(value, label);
      },
      item: (value, key) => lookup.getItem(value, typeof key === "bigint" ? values.integer(key) : values.stringPoints(key))
    }, formatting, meter);
    if (result.original?.kind === "str") return result.original;
    return result.storage === receiver.value ? receiver : values.stringPoints(result.storage);
  } });
}

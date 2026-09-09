import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { bindStrictOption } from "./strict-option.js";
import type { DictionaryValue, RuntimeValue } from "./runtime-values.js";

/** Convert the single accepted native keyword without collapsing distinct
 * multi-key Python strings into host keys. Count validation precedes conversion
 * and truth callbacks; the shared binder owns spelling suggestions. */
export function runtimeStrictOption(operation: "zip" | "map", keywords: DictionaryValue, context: { truth(value: RuntimeValue): boolean }, meter: ExecutionMeter): boolean {
  meter.checkpoint();
  if (keywords.items.size > 1) throw new PythonRuntimeError("TypeError", `${operation}() takes at most 1 keyword argument (${keywords.items.size} given)`);
  if (keywords.items.size === 0) return false;
  meter.checkpoint(0, 96);
  const names = new Map<string, RuntimeValue>();
  for (const [key, value] of keywords.items.snapshot()) {
    if (key.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
    let name = "";
    for (const point of key.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); name += String.fromCodePoint(point); }
    names.set(name, value);
  }
  return bindStrictOption(operation, names, context, meter);
}

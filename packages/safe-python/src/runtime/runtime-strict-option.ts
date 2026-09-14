import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { suggestName } from "./name-suggestion.js";
import { representationObject } from "./representation-protocol.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import type { BuiltinInvocationContext, DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Convert the single accepted native keyword without collapsing distinct
 * multi-key Python strings into host keys. CPython's dictionary parser uses
 * hash/equality lookup before truth conversion, then payload-only diagnostics. */
export function runtimeStrictOption(operation: "zip" | "map", keywords: DictionaryValue, context: { truth(value: RuntimeValue): boolean }, meter: ExecutionMeter, values: RuntimeValues, invocation?: BuiltinInvocationContext): boolean {
  meter.checkpoint();
  if (keywords.items.size > 1) throw new PythonRuntimeError("TypeError", `${operation}() takes at most 1 keyword argument (${keywords.items.size} given)`);
  if (keywords.items.size === 0) return false;
  const binding = keywords.items.lookup(values.string("strict"));
  meter.checkpoint();
  if (binding !== undefined) {
    const result = context.truth(binding.value);
    meter.checkpoint();
    return result;
  }
  for (const [key] of keywords.items.snapshot()) {
    const payload = runtimeStringPayload(key);
    if (payload === undefined) throw new PythonRuntimeError("TypeError", "keywords must be strings");
    let name = "";
    for (const point of payload.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); name += String.fromCodePoint(point); }
    if (name === "strict") continue;
    const suggestion = suggestName(name, ["strict"], meter);
    if (key.kind !== "str") {
      if (invocation?.formatting === undefined) throw Error("strict keyword diagnostics require an execution representation capability");
      const rendered = representationObject(key, "str", invocation.formatting, meter);
      const text = runtimeStringPayload(rendered);
      if (text === undefined) throw Error("validated keyword representation has no string storage");
      name = "";
      for (const point of text.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); name += String.fromCodePoint(point); }
    }
    throw new PythonRuntimeError("TypeError", `${operation}() got an unexpected keyword argument '${name}'${suggestion === undefined ? "" : `. Did you mean '${suggestion}'?`}`);
  }
  throw new PythonRuntimeError("TypeError", `invalid keyword argument for ${operation}()`);
}

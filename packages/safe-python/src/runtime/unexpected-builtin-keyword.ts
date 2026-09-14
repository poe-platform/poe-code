import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { suggestName } from "./name-suggestion.js";
import { representationObject } from "./representation-protocol.js";
import { runtimeStringPayload } from "./runtime-string-payload.js";
import type { BuiltinInvocationContext, DictionaryValue, RuntimeValues } from "./runtime-values.js";

/** The native keyword parser first binds by Unicode payload. Only leftover
 * keywords enter its diagnostic pass: tuple membership uses rich equality and
 * the error formats the original key with str, preserving subtype callbacks. */
export function unexpectedBuiltinKeyword(name: string, keywords: DictionaryValue, accepted: readonly string[], values: RuntimeValues, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): never {
  for (const [keyword] of keywords.items.snapshot()) {
    meter.checkpoint();
    const payload = runtimeStringPayload(keyword);
    if (payload === undefined) throw new PythonRuntimeError("TypeError", "keywords must be strings");
    let label = "";
    for (const point of payload.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
    let matched = false;
    for (const candidate of accepted) {
      meter.checkpoint();
      if (keyword.kind === "str") matched = label === candidate;
      else {
        if (invocation?.compareTruth === undefined) throw Error("keyword diagnostics require an execution comparison capability");
        matched = invocation.compareTruth("==", values.string(candidate), keyword);
        meter.checkpoint();
      }
      if (matched) break;
    }
    if (matched) continue;
    const suggestion = suggestName(label, accepted, meter);
    if (keyword.kind !== "str") {
      if (invocation?.formatting === undefined) throw Error("keyword diagnostics require an execution representation capability");
      const rendered = representationObject(keyword, "str", invocation.formatting, meter);
      const text = runtimeStringPayload(rendered);
      if (text === undefined) throw Error("validated keyword representation has no string storage");
      label = "";
      for (const point of text.value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); label += String.fromCodePoint(point); }
    }
    throw new PythonRuntimeError("TypeError", `${name}() got an unexpected keyword argument '${label}'${suggestion === undefined ? "" : `. Did you mean '${suggestion}'?`}`);
  }
  throw new PythonRuntimeError("TypeError", `invalid keyword argument for ${name}()`);
}

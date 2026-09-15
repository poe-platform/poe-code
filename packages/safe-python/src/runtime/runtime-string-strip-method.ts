import { PythonRuntimeError } from "./error.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { isUnicodeWhitespace } from "./unicode-whitespace.js";

/** Exact strings use boundary scans and one final slice; custom character sets
 * are indexed once, avoiding a receiver-length times character-count scan. */
export function createRuntimeStringStripMethod(receiver: RuntimeValue, name: "strip" | "lstrip" | "rstrip", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  const payload=runtimeStringPayload(receiver);
  if(payload===undefined)throw Error("string stripping requires native string storage");
  const text=payload.value;
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `str.${name}() takes no keyword arguments`);
      if (positional.length > 1) throw new PythonRuntimeError("TypeError", `${name} expected at most 1 argument, got ${positional.length}`);
      const chars = positional[0];
      const characters=chars===undefined?undefined:runtimeStringPayload(chars);
      if (chars !== undefined && chars.kind !== "none" && characters===undefined) throw new PythonRuntimeError("TypeError", `${name} arg must be None or str`);
      if (text.length === 0 || characters?.value.length===0) return receiver.kind==="str"?receiver:values.stringPoints(text);
      let members: Set<number> | undefined;
      if (characters!==undefined) {
        meter.checkpoint(1, 64); members = new Set<number>();
        for (const point of characters.value) {
          meter.checkpoint();
          if (!members.has(point)) { meter.checkpoint(0, 32); members.add(point); }
        }
      }
      const matches = members === undefined ? isUnicodeWhitespace : (point: number) => members.has(point);
      let start = 0n, stop = BigInt(text.length);
      if (name !== "rstrip") while (start < stop && matches(text.codePointAt(start, meter))) start++;
      if (name !== "lstrip") while (stop > start && matches(text.codePointAt(stop - 1n, meter))) stop--;
      if (start === 0n && stop === BigInt(text.length)) return receiver.kind==="str"?receiver:values.stringPoints(text);
      return values.stringPoints(text.slice(start, stop, null, meter), "canonical");
    }
  });
}

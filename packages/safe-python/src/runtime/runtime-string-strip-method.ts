import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { isUnicodeWhitespace } from "./unicode-whitespace.js";

/** Exact strings use boundary scans and one final slice; custom character sets
 * are indexed once, avoiding a receiver-length times character-count scan. */
export function createRuntimeStringStripMethod(receiver: Extract<RuntimeValue, { kind: "str" }>, name: "strip" | "lstrip" | "rstrip", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `str.${name}() takes no keyword arguments`);
      if (positional.length > 1) throw new PythonRuntimeError("TypeError", `${name} expected at most 1 argument, got ${positional.length}`);
      const chars = positional[0];
      if (chars !== undefined && chars.kind !== "none" && chars.kind !== "str") throw new PythonRuntimeError("TypeError", `${name} arg must be None or str`);
      if (receiver.value.length === 0 || (chars?.kind === "str" && chars.value.length === 0)) return receiver;
      let members: Set<number> | undefined;
      if (chars?.kind === "str") {
        meter.checkpoint(1, 64); members = new Set<number>();
        for (const point of chars.value) {
          meter.checkpoint();
          if (!members.has(point)) { meter.checkpoint(0, 32); members.add(point); }
        }
      }
      const matches = members === undefined ? isUnicodeWhitespace : (point: number) => members.has(point);
      let start = 0n, stop = BigInt(receiver.value.length);
      if (name !== "rstrip") while (start < stop && matches(receiver.value.codePointAt(start, meter))) start++;
      if (name !== "lstrip") while (stop > start && matches(receiver.value.codePointAt(stop - 1n, meter))) stop--;
      if (start === 0n && stop === BigInt(receiver.value.length)) return receiver;
      return values.stringPoints(receiver.value.slice(start, stop, null, meter));
    }
  });
}

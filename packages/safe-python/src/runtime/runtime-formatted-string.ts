import { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { FormattedStringContext } from "./formatted-string-evaluation.js";
import { formatObject, type FormatContext } from "./format-protocol.js";
import { representationObject } from "./representation-protocol.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** F-string operations share one formatting/representation context so guest
 * hooks and representation recursion guards survive across field conversions.
 * Joining copies code points once, never coerces results or merges surrogates. */
export function createRuntimeFormattedStringContext(values: RuntimeValues, context: FormatContext<RuntimeValue>, meter: ExecutionMeter): FormattedStringContext<RuntimeValue> {
  meter.checkpoint(1, 256);
  return {
    text(value) {
      meter.checkpoint();
      return typeof value === "string" ? values.string(value) : values.stringPoints(value);
    },
    convert: (value, conversion) => representationObject(value, conversion === "s" ? "str" : conversion === "r" ? "repr" : "ascii", context, meter),
    format: (value, spec) => formatObject(value, spec, context, meter),
    join(parts) {
      meter.checkpoint(1, parts.length * 16);
      const storage: CodePointString[] = [];
      for (const part of parts) {
        const text = context.string(part); meter.checkpoint();
        if (text === undefined) throw new Error("formatted string part lost validated string storage");
        storage.push(text);
      }
      if (parts.length === 1) return parts[0];
      const separator = new CodePointString(new Uint32Array(), meter);
      return values.stringPoints(separator.join(storage, meter));
    }
  };
}

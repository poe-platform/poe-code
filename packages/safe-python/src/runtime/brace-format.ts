import { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { scanBraceFormat } from "./brace-format-scan.js";
import { FormatFieldResolver, type FormatFieldHooks } from "./format-field-resolver.js";
import { formatObject, type FormatContext } from "./format-protocol.js";
import { representationObject } from "./representation-protocol.js";

/** Assemble str.format semantics over explicit guest capabilities. Nested specs
 * share argument numbering; expansion is limited to two build levels, so this
 * helper's host recursion is bounded independently of untrusted input size.
 * The caller owns public method validation and exact-str result construction. */
export function braceFormat<Value>(source: CodePointString, positional: readonly Value[] | null, hooks: FormatFieldHooks<Value>, context: FormatContext<Value>, meter: ExecutionMeter): CodePointString {
  meter.checkpoint(1, 256);
  const resolver = new FormatFieldResolver(positional, hooks, meter);
  const empty = new CodePointString(new Uint32Array(0), meter);
  function build(start: number, end: number, depth: number): CodePointString {
    meter.checkpoint(1, 192);
    if (depth === 0) throw new PythonRuntimeError("ValueError", "Max string recursion exceeded");
    const parts: CodePointString[] = [];
    for (const part of scanBraceFormat(source, meter, start, end)) {
      if (part.literal.end !== part.literal.start) {
        meter.checkpoint(1, 16);
        parts.push(source.slice(BigInt(part.literal.start), BigInt(part.literal.end), null, meter));
      }
      if (part.field === null) continue;
      let value = resolver.resolve(source, part.field.start, part.field.end);
      const conversion = part.conversion;
      if (conversion !== null) {
        if (conversion !== 115 && conversion !== 114 && conversion !== 97) {
          const name = conversion > 32 && conversion < 127 ? String.fromCharCode(conversion) : `\\x${conversion.toString(16)}`;
          throw new PythonRuntimeError("ValueError", `Unknown conversion specifier ${name}`);
        }
        value = representationObject(value, conversion === 115 ? "str" : conversion === 114 ? "repr" : "ascii", context, meter);
      }
      if (part.spec === null) throw new Error("format field lost its specification");
      const storage = part.expand ? build(part.spec.start, part.spec.end, depth - 1)
        : source.slice(BigInt(part.spec.start), BigInt(part.spec.end), null, meter);
      const spec = context.stringPoints(storage); meter.checkpoint();
      const result = formatObject(value, spec, context, meter);
      const rendered = context.string(result); meter.checkpoint();
      if (rendered === undefined) throw new Error("validated format result lost string storage");
      meter.checkpoint(1, 16); parts.push(rendered);
    }
    if (parts.length === 0) return empty;
    if (parts.length === 1) return parts[0];
    return empty.join(parts, meter);
  }
  return build(0, source.length, 2);
}

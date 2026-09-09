import type { CodePointString } from "./code-point-string.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { parseFormatSpec } from "./format-spec.js";

/** Native str payload formatting. The runtime owns guest string identity and
 * the empty-spec str-subclass __str__ path; this renderer handles storage only.
 * Shared syntax validation precedes string presentation/flag restrictions. */
export function stringFormat(source: CodePointString, spec: CodePointString, typeName: string, meter: ExecutionMeter): CodePointString {
  meter.checkpoint();
  if (spec.length === 0) return source;
  const field = parseFormatSpec(spec, 115, "<", typeName, meter);
  if (field.type !== 115) {
    const code = field.type > 32 && field.type < 128 ? String.fromCharCode(field.type) : `\\x${field.type.toString(16)}`;
    throw new PythonRuntimeError("ValueError", `Unknown format code '${code}' for object of type '${diagnosticTypeName(typeName, meter)}'`);
  }
  if (field.sign !== null) throw new PythonRuntimeError("ValueError", `${field.sign === " " ? "Space" : "Sign"} not allowed in string format specifier`);
  if (field.noNegativeZero) throw new PythonRuntimeError("ValueError", "Negative zero coercion (z) not allowed in string format specifier");
  if (field.alternate) throw new PythonRuntimeError("ValueError", "Alternate form (#) not allowed in string format specifier");
  if (field.align === "=") throw new PythonRuntimeError("ValueError", "'=' alignment not allowed in string format specifier");
  return source.formatField(field.width ?? 0n, field.precision, field.align === "<" ? "left" : field.align === ">" ? "right" : "center", field.fill, meter);
}

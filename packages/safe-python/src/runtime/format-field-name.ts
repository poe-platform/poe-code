import type { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { unicodeDecimal } from "./unicode-decimal.js";

export interface FormatFieldStep {
  readonly kind: "first" | "attribute" | "item";
  readonly start: number;
  readonly end: number;
  readonly index: bigint | null;
}

/** Lazy lookup steps over original source spans. A consumer performs each lookup
 * before requesting the next step, preserving guest-error precedence. Empty
 * first names are retained for the caller's shared auto-numbering state. */
export function* scanFormatFieldName(source: CodePointString, meter: ExecutionMeter, start = 0, end = source.length): Generator<FormatFieldStep> {
  meter.checkpoint(1, 192);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) throw new RangeError("invalid format field span");
  let position = start;
  const point = () => position < end ? source.codePointAt(BigInt(position), meter) : undefined;
  const index = (start: number, end: number): bigint | null => {
    if (start === end) return null;
    let value = 0n;
    for (let i = start; i < end; i++) {
      const digit = unicodeDecimal(source.codePointAt(BigInt(i), meter), meter);
      if (digit < 0) return null;
      meter.checkpoint(1, 64);
      value = value * 10n + BigInt(digit);
      if (value > 9223372036854775807n) throw new PythonRuntimeError("ValueError", "Too many decimal digits in format string");
    }
    return value;
  };
  let code = point();
  while (code !== undefined && code !== 46 && code !== 91) { position++; code = point(); }
  const firstIndex = index(start, position);
  meter.checkpoint(1, 96);
  yield { kind: "first", start, end: position, index: firstIndex };
  while (position < end) {
    const marker = point();
    if (marker !== 46 && marker !== 91) throw new PythonRuntimeError("ValueError", "Only '.' or '[' may follow ']' in format field specifier");
    const itemStart = ++position;
    code = point();
    if (marker === 46) {
      while (code !== undefined && code !== 46 && code !== 91) { position++; code = point(); }
    } else {
      while (code !== undefined && code !== 93) { position++; code = point(); }
      if (code === undefined) throw new PythonRuntimeError("ValueError", "Missing ']' in format string");
    }
    const itemEnd = position;
    if (marker === 91) position++;
    const itemIndex = marker === 91 ? index(itemStart, itemEnd) : null;
    if (itemStart === itemEnd) throw new PythonRuntimeError("ValueError", "Empty attribute in format string");
    meter.checkpoint(1, 96);
    yield { kind: marker === 46 ? "attribute" : "item", start: itemStart, end: itemEnd, index: itemIndex };
  }
}

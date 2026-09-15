import type { CodePointString } from "./code-point-string.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

interface FormatSpan { readonly start: number; readonly end: number }
export interface BraceFormatPart {
  readonly literal: FormatSpan;
  readonly field: FormatSpan | null;
  readonly spec: FormatSpan | null;
  readonly conversion: number | null;
  readonly expand: boolean;
}

/** Lazy str.format markup. All spans refer to the original immutable source;
 * field lookup, conversion validation and nested expansion belong to consumers.
 * A malformed field fails before its accompanying literal is yielded. */
export function* scanBraceFormat(source: CodePointString, meter: ExecutionMeter, start = 0, end = source.length): Generator<BraceFormatPart> {
  meter.checkpoint(1, 128);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) throw new RangeError("invalid format source span");
  let position = start;
  const point = () => position < end ? source.codePointAt(BigInt(position), meter) : undefined;
  while (position < end) {
    const literalStart = position;
    let code = point();
    while (code !== undefined && code !== 123 && code !== 125) { position++; code = point(); }
    const literalEnd = position;
    if (code === undefined) {
      meter.checkpoint(1, 160);
      yield { literal: { start: literalStart, end: literalEnd }, field: null, spec: null, conversion: null, expand: false };
      return;
    }
    position++;
    if (point() === code) {
      position++;
      meter.checkpoint(1, 160);
      yield { literal: { start: literalStart, end: literalEnd + 1 }, field: null, spec: null, conversion: null, expand: false };
      continue;
    }
    if (code === 125 || position === end) throw new PythonRuntimeError("ValueError", `Single '${code === 125 ? "}" : "{"}' encountered in format string`);
    const fieldStart = position;
    code = point();
    while (code !== undefined && code !== 125 && code !== 58 && code !== 33) {
      if (code === 123) throw new PythonRuntimeError("ValueError", "unexpected '{' in field name");
      if (code === 91) {
        do { position++; code = point(); } while (code !== undefined && code !== 93);
        if (code === undefined) break;
      }
      position++; code = point();
    }
    if (code === undefined) throw new PythonRuntimeError("ValueError", "expected '}' before end of string");
    const fieldEnd = position++;
    let conversion: number | null = null, expand = false;
    let specStart = position, specEnd = position;
    if (code === 33) {
      const value = point();
      if (value === undefined) throw new PythonRuntimeError("ValueError", "end of string while looking for conversion specifier");
      conversion = value === 0 ? null : value;
      position++;
      code = point();
      if (code !== undefined) {
        if (code !== 125 && code !== 58) throw new PythonRuntimeError("ValueError", "expected ':' after conversion specifier");
        position++;
      }
      specStart = specEnd = position;
    }
    if (code !== 125) {
      let depth = 1;
      while (position < end) {
        const value = point();
        if (value === 123) { depth++; expand = true; }
        if (value === 125 && --depth === 0) break;
        position++;
      }
      if (position === end) throw new PythonRuntimeError("ValueError", "unmatched '{' in format spec");
      specEnd = position++;
    }
    meter.checkpoint(1, 224);
    yield { literal: { start: literalStart, end: literalEnd }, field: { start: fieldStart, end: fieldEnd }, spec: { start: specStart, end: specEnd }, conversion, expand };
  }
}

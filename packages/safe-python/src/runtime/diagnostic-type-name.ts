import type { ExecutionMeter } from "./execution-budget.js";

/** Python's %.200s type diagnostics retain complete UTF-8 characters only.
 * Type names are trusted host metadata, not guest string conversions. */
export function diagnosticTypeName(name: string, meter: ExecutionMeter): string {
  meter.checkpoint();
  let bytes = 0, end = 0;
  for (const character of name) {
    meter.checkpoint();
    const point = character.codePointAt(0)!;
    const size = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    if (bytes + size > 200) break;
    bytes += size; end += character.length;
  }
  if (end === name.length) return name;
  meter.checkpoint(0, end * 2);
  return name.slice(0, end);
}

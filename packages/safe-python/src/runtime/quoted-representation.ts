import type { CodePointString } from "./code-point-string.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { isUnicodeCharacter } from "./unicode-character-classification.js";

/** Quote escaping is counted separately, after selecting the delimiter. */
function escapeSize(point: number, ascii: boolean, meter: ExecutionMeter): number {
  if (point === 92 || point === 9 || point === 10 || point === 13) return 2;
  if (point >= 32 && point < 127) return 1;
  if (point >= 128 && !ascii && isUnicodeCharacter(point, "isprintable", meter)) return 1;
  return point <= 255 ? 4 : point <= 65535 ? 6 : 10;
}

/** Internal owned-buffer producer for immutable text/bytes storage. Two scans
 * select quotes and preflight output before writing one charged code-point
 * buffer. Bytes mode never decodes input and always escapes high bytes. The
 * caller takes sole ownership of the returned buffer; it must not be exposed. */
export function renderQuotedPoints(source: CodePointString | ImmutableBytes, mode: "repr" | "ascii" | "bytes", meter: ExecutionMeter): Uint32Array {
  meter.checkpoint();
  const ascii = mode !== "repr";
  let length = mode === "bytes" ? 3 : 2, singles = 0, doubles = 0;
  for (const point of source) {
    meter.checkpoint();
    if (point === 39) singles++;
    else if (point === 34) doubles++;
    length += escapeSize(point, ascii, meter);
    if (length > 0xffffffff) exhaustAllocation(meter);
  }
  const quote = singles > 0 && doubles === 0 ? 34 : 39;
  length += quote === 39 ? singles : doubles;
  if (length > 0xffffffff) exhaustAllocation(meter);
  meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
  const points = new Uint32Array(length);
  let offset = 0;
  if (mode === "bytes") points[offset++] = 98;
  points[offset++] = quote;
  for (const point of source) {
    meter.checkpoint();
    const size = escapeSize(point, ascii, meter);
    if (point === quote || point === 92) { points[offset++] = 92; points[offset++] = point; }
    else if (size === 1) points[offset++] = point;
    else if (size === 2) { points[offset++] = 92; points[offset++] = point === 9 ? 116 : point === 10 ? 110 : 114; }
    else {
      points[offset++] = 92;
      points[offset++] = size === 4 ? 120 : size === 6 ? 117 : 85;
      for (let shift = (size - 3) * 4; shift >= 0; shift -= 4) {
        meter.checkpoint();
        const digit = (point >>> shift) & 15;
        points[offset++] = digit < 10 ? 48 + digit : 87 + digit;
      }
    }
  }
  points[offset] = quote;
  return points;
}

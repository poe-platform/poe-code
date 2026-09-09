import { CodePointString } from "./code-point-string.js";
import { PythonDecodeError } from "./decode-error.js";
import type { ExecutionMeter } from "./execution-budget.js";

export type Utf8DecodeErrors = "strict" | "ignore" | "replace" | "surrogateescape" | "surrogatepass" | "backslashreplace";
type Utf8Unit = { end: number; point: number } | { end: number; reason: string };
export interface Utf8Decoded {
  readonly text: CodePointString;
  readonly consumed: number;
}

/** Decode UTF-8, returning the consumed byte count for incremental buffering. */
export function decodeUtf8(input: Uint8Array, errors: Utf8DecodeErrors = "strict", meter?: ExecutionMeter, final = true): Utf8Decoded {
  const capacity = input.length * (errors === "backslashreplace" ? 4 : 1);
  meter?.checkpoint(1, capacity * Uint32Array.BYTES_PER_ELEMENT);
  const points = new Uint32Array(capacity);
  let written = 0;
  let start = 0;
  for (; start < input.length;) {
    meter?.checkpoint();
    const unit = readUnit(input, start, final);
    if (unit === null) break;
    if ("point" in unit) {
      points[written++] = unit.point;
    } else if (errors === "surrogatepass" && input[start] === 0xed && start + 2 < input.length &&
      input[start + 1]! >= 0xa0 && input[start + 1]! <= 0xbf && input[start + 2]! >= 0x80 && input[start + 2]! <= 0xbf) {
      // Python's surrogatepass handler repairs only a complete encoded surrogate;
      // otherwise it preserves the original strict decoder error span/reason.
      points[written++] = 0xd000 | ((input[start + 1]! & 0x3f) << 6) | (input[start + 2]! & 0x3f);
      start += 3;
      continue;
    } else if (errors === "replace") {
      points[written++] = 0xfffd;
    } else if (errors === "surrogateescape" || errors === "backslashreplace") {
      for (let index = start; index < unit.end; index++) {
        meter?.checkpoint();
        const byte = input[index]!;
        if (errors === "surrogateescape") points[written++] = 0xdc00 + byte;
        else {
          points[written++] = 92;
          points[written++] = 120;
          points[written++] = "0123456789abcdef".charCodeAt(byte >> 4);
          points[written++] = "0123456789abcdef".charCodeAt(byte & 15);
        }
      }
    } else if (errors !== "ignore") {
      throw new PythonDecodeError("utf-8", input, start, unit.end, unit.reason, meter);
    }
    start = unit.end;
  }
  return { text: new CodePointString(points.subarray(0, written), meter), consumed: start };
}

function readUnit(input: Uint8Array, start: number, final: boolean): Utf8Unit | null {
  const lead = input[start]!;
  if (lead < 0x80) return { point: lead, end: start + 1 };
  const width = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0;
  if (width === 0) return { reason: "invalid start byte", end: start + 1 };
  // CPython defers an incomplete surrogate candidate in every error mode.
  if (!final && lead === 0xed && input.length - start === 2 && input[start + 1]! >= 0xa0 && input[start + 1]! <= 0xbf) return null;
  let point = lead & (0x7f >> width);
  for (let offset = 1; offset < width; offset++) {
    if (start + offset === input.length) return final ? { reason: "unexpected end of data", end: input.length } : null;
    const byte = input[start + offset]!;
    const lower = offset === 1 && lead === 0xe0 ? 0xa0 : offset === 1 && lead === 0xf0 ? 0x90 : 0x80;
    const upper = offset === 1 && lead === 0xed ? 0x9f : offset === 1 && lead === 0xf4 ? 0x8f : 0xbf;
    if (byte < lower || byte > upper) return { reason: "invalid continuation byte", end: start + offset };
    point = (point << 6) | (byte & 0x3f);
  }
  return { point, end: start + width };
}

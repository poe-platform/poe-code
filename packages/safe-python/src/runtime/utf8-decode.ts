import { CodePointString } from "./code-point-string.js";
import { PythonDecodeError,type DecodeErrorLocation } from "./decode-error.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";

export type Utf8DecodeErrors = "strict" | "ignore" | "replace" | "surrogateescape" | "surrogatepass" | "backslashreplace";
/** The registry validates guest replacement types and resume positions before
 * the kernel resumes. A callback may replace the complete input byte object. */
export type Utf8DecodeRecovery = (error: PythonDecodeError) => { replacement: CodePointString; position: number; input: Uint8Array };
type Utf8Unit = { end: number; point: number } | { end: number; reason: string };
export interface Utf8Decoded {
  readonly text: CodePointString;
  readonly consumed: number;
}

/** Decode UTF-8 with the low-level codec's consumed count: final calls consume
 * the original length even after recovery replaces the input. Nonfinal calls
 * report the cursor in the replacement input for incremental buffering. */
export function decodeUtf8(input: Uint8Array, errors: Utf8DecodeErrors | Utf8DecodeRecovery = "strict", meter?: ExecutionMeter, final = true, nativeCString = false): Utf8Decoded {
  const originalLength = input.length;
  let minimumMaximum = 127;
  // NULL-errors, non-stateful decoding preallocates from the first non-ASCII
  // byte before validating it. Named strict and incremental decoding do not.
  if (nativeCString) for (const byte of input) {
    meter?.checkpoint();
    if (byte < 128) continue;
    if (byte >= 0xc2) minimumMaximum = byte < 0xc4 ? 255 : byte < 0xf0 ? 65535 : 0x10ffff;
    break;
  }
  const capacity = input.length * (errors === "backslashreplace" ? 4 : 1);
  // Scratch buffers own typed-array metadata even for an empty payload.
  meter?.checkpoint(1, 64 + capacity * Uint32Array.BYTES_PER_ELEMENT);
  let points = new Uint32Array(capacity);
  let written = 0;
  const append = (point: number) => {
    minimumMaximum = Math.max(minimumMaximum, point);
    if (written === points.length) {
      const size = Math.max(16, points.length * 2);
      meter?.checkpoint(written + 1, 64 + size * Uint32Array.BYTES_PER_ELEMENT);
      const grown = new Uint32Array(size);
      grown.set(points);
      points = grown;
    }
    points[written++] = point;
  };
  let start = 0;
  let initial:DecodeErrorLocation|undefined;
  for (; start < input.length;) {
    meter?.checkpoint();
    const unit = readUnit(input, start, final);
    if (unit === null) break;
    if ("point" in unit) {
      append(unit.point);
    } else if (errors === "surrogatepass" && input[start] === 0xed && start + 2 < input.length &&
      input[start + 1]! >= 0xa0 && input[start + 1]! <= 0xbf && input[start + 2]! >= 0x80 && input[start + 2]! <= 0xbf) {
      if(initial===undefined){meter?.checkpoint(0,48);initial={start,end:unit.end,reason:unit.reason};}
      // Python's surrogatepass handler repairs only a complete encoded surrogate;
      // otherwise it preserves the original strict decoder error span/reason.
      append(0xd000 | ((input[start + 1]! & 0x3f) << 6) | (input[start + 2]! & 0x3f));
      start += 3;
      continue;
    } else if (errors === "replace") {
      append(0xfffd);
    } else if (errors === "surrogateescape" || errors === "backslashreplace") {
      for (let index = start; index < unit.end; index++) {
        meter?.checkpoint();
        const byte = input[index]!;
        if (errors === "surrogateescape") append(0xdc00 + byte);
        else {
          append(92);
          append(120);
          append("0123456789abcdef".charCodeAt(byte >> 4));
          append("0123456789abcdef".charCodeAt(byte & 15));
        }
      }
    } else if (errors !== "ignore") {
      const error = new PythonDecodeError("utf-8", input, start, unit.end, unit.reason, meter,initial);
      if (typeof errors !== "function") throw error;
      let fatal = false, result: ReturnType<Utf8DecodeRecovery>;
      try { result = errors(error); }
      catch (failure) { fatal = failure instanceof ExecutionLimitError; throw failure; }
      finally { if (!fatal) meter?.checkpoint(); }
      if (meter !== undefined && result.replacement.length !== 0) {
        minimumMaximum = Math.max(minimumMaximum, result.replacement.storageMaximum(meter));
      }
      for (const point of result.replacement) { meter?.checkpoint(); append(point); }
      input = result.input;
      start = result.position;
      continue;
    }
    start = unit.end;
  }
  // Admit the result record, string wrapper, copied array and temporary view.
  // CodePointString separately charges the copied code-point payload.
  meter?.checkpoint(0, 192);
  return { text: CodePointString.fromUnicodeWriter(points.subarray(0, written), minimumMaximum, meter), consumed: final ? originalLength : start };
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

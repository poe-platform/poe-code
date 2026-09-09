import type { CodePointString } from "./code-point-string.js";
import { PythonEncodeError } from "./encode-error.js";
import type { ExecutionMeter } from "./execution-budget.js";

export type Utf8EncodeErrors = "strict" | "ignore" | "replace" | "backslashreplace" | "xmlcharrefreplace" | "namereplace" | "surrogateescape" | "surrogatepass";

/** Encode complete internal string storage into an independently owned byte buffer. */
export function encodeUtf8(input: CodePointString, errors: Utf8EncodeErrors = "strict", meter?: ExecutionMeter): Uint8Array {
  const capacity = input.length * (errors === "xmlcharrefreplace" ? 8 : errors === "backslashreplace" || errors === "namereplace" ? 6 : 4);
  meter?.checkpoint(1, capacity);
  const output = new Uint8Array(capacity);
  let written = 0;
  for (let index = 0; index < input.length;) {
    const point = input.codePointAt(BigInt(index), meter);
    if (point < 0xd800 || point > 0xdfff || errors === "surrogatepass") {
      written = writePoint(point, output, written);
      index++;
      continue;
    }
    if (errors === "surrogateescape" && point >= 0xdc80 && point <= 0xdcff) {
      output[written++] = point - 0xdc00;
      index++;
      continue;
    }
    let end = index + 1;
    while (end < input.length) {
      const next = input.codePointAt(BigInt(end), meter);
      if (next < 0xd800 || next > 0xdfff) break;
      end++;
    }
    if (errors === "strict" || errors === "surrogateescape") throw new PythonEncodeError("utf-8", input, index, end, "surrogates not allowed");
    for (; index < end; index++) {
      meter?.checkpoint();
      if (errors === "ignore") continue;
      if (errors === "replace") output[written++] = 63;
      else {
        const surrogate = input.codePointAt(BigInt(index), meter);
        // Surrogates have no Unicode character names; namereplace uses escapes.
        const replacement = errors === "xmlcharrefreplace" ? `&#${surrogate};` : `\\u${surrogate.toString(16)}`;
        for (let offset = 0; offset < replacement.length; offset++) output[written++] = replacement.charCodeAt(offset);
      }
    }
  }
  meter?.checkpoint(written, written);
  return output.slice(0, written);
}

function writePoint(point: number, output: Uint8Array, offset: number): number {
  if (point <= 0x7f) output[offset++] = point;
  else if (point <= 0x7ff) {
    output[offset++] = 0xc0 | (point >> 6);
    output[offset++] = 0x80 | (point & 0x3f);
  } else if (point <= 0xffff) {
    output[offset++] = 0xe0 | (point >> 12);
    output[offset++] = 0x80 | ((point >> 6) & 0x3f);
    output[offset++] = 0x80 | (point & 0x3f);
  } else {
    output[offset++] = 0xf0 | (point >> 18);
    output[offset++] = 0x80 | ((point >> 12) & 0x3f);
    output[offset++] = 0x80 | ((point >> 6) & 0x3f);
    output[offset++] = 0x80 | (point & 0x3f);
  }
  return offset;
}

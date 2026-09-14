import type { CodePointString } from "./code-point-string.js";
import { PythonEncodeError } from "./encode-error.js";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { rejectEncodingReplacement } from "./reject-encoding-replacement.js";

export type Utf8EncodeErrors = "strict" | "ignore" | "replace" | "backslashreplace" | "xmlcharrefreplace" | "namereplace" | "surrogateescape" | "surrogatepass";
/** Registry adapters validate guest types and resume positions. A failed text
 * replacement must raise the original, possibly mutated guest exception. */
export type Utf8EncodeRecovery = (error: PythonEncodeError) => { replacement: CodePointString | Uint8Array; position: number; failure?: unknown; rejectReplacement?: () => never };

/** Encode complete internal string storage into an independently owned byte buffer. */
export function encodeUtf8(input: CodePointString, errors: Utf8EncodeErrors | Utf8EncodeRecovery = "strict", meter?: ExecutionMeter, recover?: Utf8EncodeRecovery): Uint8Array {
  const capacity = input.length * (errors === "xmlcharrefreplace" ? 8 : errors === "backslashreplace" || errors === "namereplace" ? 6 : 4);
  // Typed-array objects consume storage even when the encoded payload is empty.
  meter?.checkpoint(1, 64 + capacity);
  let output = new Uint8Array(capacity);
  let written = 0;
  const reserve = (count: number) => {
    if (written + count <= output.length) return;
    const size = Math.max(written + count, output.length * 2);
    // Admit both the grown buffer and the temporary view before creating them.
    meter?.checkpoint(written + 1, 128 + size);
    const grown = new Uint8Array(size);
    grown.set(output.subarray(0, written));
    output = grown;
  };
  for (let index = 0; index < input.length;) {
    const point = input.codePointAt(BigInt(index), meter);
    reserve(4);
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
    const recoveryHandler = typeof errors === "function" ? errors : errors === "surrogateescape" ? recover : undefined;
    if (recoveryHandler !== undefined || errors === "strict" || errors === "surrogateescape") {
      // The fault retains the input and a bounded position diagnostic. Admit
      // its storage before constructing it or entering guest recovery.
      meter?.checkpoint(0, 512);
    }
    if (recoveryHandler !== undefined) {
      const error = new PythonEncodeError("utf-8", input, index, end, "surrogates not allowed");
      let fatal = false, recovery: ReturnType<Utf8EncodeRecovery>;
      try { recovery = recoveryHandler(error); }
      catch (failure) { fatal = failure instanceof ExecutionLimitError; throw failure; }
      finally { if (!fatal) meter?.checkpoint(); }
      const replacement = recovery.replacement;
      if (!(replacement instanceof Uint8Array)) {
        // PyUnicode_IS_ASCII checks native storage, not just code points.
        // C-name decoding recovery can retain non-ASCII storage for ASCII text.
        if (!replacement.isAsciiStorage(meter)) rejectEncodingReplacement(recovery, error, meter);
      }
      reserve(replacement.length);
      for (const byte of replacement) { meter?.checkpoint(); output[written++] = byte; }
      index = recovery.position;
      continue;
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
  meter?.checkpoint(written, 64 + written);
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

import type {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";
import {prepareIdnaName} from "./idna-nameprep.js";
import {encodePunycode} from "./punycode.js";
import {encodeSingleByte} from "./single-byte-encode.js";

/** Immutable-default RFC 3490 ToASCII kernel, including the ASCII fast path
 * that bypasses Nameprep and STD3 checks. Public encodings.idna must separately
 * execute its mutable guest dependencies; this does not publish that module.
 */
export function encodeIdnaAsciiLabel(input: CodePointString, meter: ExecutionMeter): Uint8Array {
  let fatal = false;
  try {
    meter.checkpoint(1, 64);
    let label = input;
    for (let attempt = 0; attempt < 2; attempt++) {
      let ascii: Uint8Array | undefined;
      try { ascii = encodeSingleByte(label, "ascii", "strict", meter); }
      catch (error) { if (!(error instanceof PythonEncodeError)) throw error; }
      if (ascii !== undefined) {
        if (ascii.length > 0 && ascii.length < 64) return ascii;
        meter.checkpoint(1, 192);
        throw new PythonEncodeError("idna", label, 0, label.length || 1, label.length === 0 ? "label empty" : "label too long");
      }
      if (attempt === 0) label = prepareIdnaName(label, meter);
    }
    // Nameprep has already mapped ASCII uppercase characters to lowercase.
    if (label.length >= 4 && label.codePointAt(0n, meter) === 120 && label.codePointAt(1n, meter) === 110 &&
        label.codePointAt(2n, meter) === 45 && label.codePointAt(3n, meter) === 45) {
      meter.checkpoint(1, 192);
      throw new PythonEncodeError("idna", label, 0, 4, "Label starts with ACE prefix");
    }
    const encoded = encodePunycode(label, meter);
    if (encoded.length + 4 >= 64) {
      meter.checkpoint(1, 192);
      throw new PythonEncodeError("idna", label, 0, label.length, "label too long");
    }
    meter.checkpoint(encoded.length + 4, encoded.length + 4);
    const result = new Uint8Array(encoded.length + 4);
    result.set([120, 110, 45, 45]);
    result.set(encoded, 4);
    return result;
  } catch (error) { fatal = error instanceof ExecutionLimitError; throw error; }
  finally { if (!fatal) meter.checkpoint(); }
}

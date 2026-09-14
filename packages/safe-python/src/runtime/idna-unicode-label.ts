import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";
import {encodeIdnaAsciiLabel} from "./idna-ascii-label.js";
import {prepareIdnaName} from "./idna-nameprep.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {decodePunycode} from "./punycode.js";
import {renderQuotedPoints} from "./quoted-representation.js";
import {decodeSingleByte} from "./single-byte-decode.js";
import {encodeSingleByte} from "./single-byte-encode.js";
import {encodeUtf8} from "./utf8-encode.js";

/** Default RFC 3490 ToUnicode over owned bytes/code points and pinned kernels.
 * Public IDNA wrappers must separately preserve live guest module dependencies,
 * subtype protocols and frames; this kernel does not publish encodings.idna.
 */
export function decodeIdnaUnicodeLabel(input: CodePointString | Uint8Array, meter: ExecutionMeter): CodePointString {
  let fatal = false;
  try {
    meter.checkpoint(1, 64);
    if (input.length > 1024) {
      const object = input instanceof CodePointString ? encodeUtf8(input, "backslashreplace", meter) : input;
      throw new PythonDecodeError("idna", object, 0, object.length, "label way too long", meter);
    }
    let label: Uint8Array;
    if (input instanceof CodePointString) {
      let ascii: Uint8Array | undefined;
      try {ascii = encodeSingleByte(input, "ascii", "strict", meter);}
      catch (error) {if (!(error instanceof PythonEncodeError)) throw error;}
      if (ascii === undefined) {
        const prepared = prepareIdnaName(input, meter);
        try {ascii = encodeSingleByte(prepared, "ascii", "strict", meter);}
        catch (error) {
          if (!(error instanceof PythonEncodeError)) throw error;
          meter.checkpoint(1, 192);
          throw new PythonEncodeError("idna", prepared, error.start, error.end, "Invalid character in IDN label", undefined, {context: error});
        }
      }
      label = ascii;
    } else label = input;
    const ace = label.length >= 4 && (label[0] === 120 || label[0] === 88) &&
      (label[1] === 110 || label[1] === 78) && label[2] === 45 && label[3] === 45;
    if (!ace) return decodeSingleByte(label, "ascii", "strict", meter).text;
    let result: CodePointString;
    try {result = decodePunycode(label.subarray(4), "strict", meter);}
    catch (error) {
      if (!(error instanceof PythonDecodeError)) throw error;
      const start = BigInt(error.start) + 4n, end = BigInt(error.end) + 4n;
      meter.checkpoint(1, 192);
      if (start < -(1n << 63n) || start >= (1n << 63n) || end < -(1n << 63n) || end >= (1n << 63n)) {
        throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t", {context: error});
      }
      throw new PythonDecodeError("idna", label, start, end, error.reason, meter, undefined, {context: error});
    }
    const encoded = encodeIdnaAsciiLabel(result, meter);
    // The reference decodes the original bytes strictly before comparing, even
    // if the two lengths differ. Preserve that error precedence.
    const original = decodeSingleByte(label, "ascii", "strict", meter).text;
    let equal = original.length === encoded.length, index = 0;
    for (const point of original) {
      meter.checkpoint();
      const lower = point >= 65 && point <= 90 ? point + 32 : point;
      if (lower !== encoded[index++]) equal = false;
    }
    if (!equal) {
      const representations: string[] = [];
      for (const bytes of [label, encoded]) {
        let representation = "";
        for (const point of renderQuotedPoints(ImmutableBytes.copyOf(bytes, meter), "bytes", meter)) {
          meter.checkpoint(1, 2);
          representation += String.fromCodePoint(point);
        }
        representations.push(representation);
      }
      meter.checkpoint(1, 192 + representations[0].length * 2 + representations[1].length * 2);
      throw new PythonDecodeError("idna", label, 0, label.length,
        `IDNA does not round-trip, '${representations[0]}' != '${representations[1]}'`, meter);
    }
    return result;
  } catch (error) {fatal = error instanceof ExecutionLimitError; throw error;}
  finally {if (!fatal) meter.checkpoint();}
}

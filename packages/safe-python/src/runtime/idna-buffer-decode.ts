import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";
import {decodeIdnaUnicodeLabel} from "./idna-unicode-label.js";
import {decodeSingleByte} from "./single-byte-decode.js";
import {encodeSingleByte} from "./single-byte-encode.js";

/** Default IDNA _buffer_decode over owned byte or Unicode storage. Guest
 * buffering, live dependencies and descriptors are separate interpreter work. */
export function decodeIdnaBuffer(input: CodePointString | Uint8Array, errors: string, final: boolean, meter: ExecutionMeter): {output: CodePointString; consumed: number} {
  let fatal = false;
  try {
    meter.checkpoint(1, 64);
    if (errors !== "strict") {
      meter.checkpoint(1, 128 + errors.length * 2);
      throw new PythonRuntimeError("UnicodeError", `Unsupported error handling: ${errors}`);
    }
    if (input.length === 0) {
      meter.checkpoint(0, 192);
      return {output: new CodePointString(new Uint32Array(), meter), consumed: 0};
    }
    const unicode = input instanceof CodePointString;
    let text: CodePointString;
    if (unicode) text = input;
    else {
      try {text = decodeSingleByte(input, "ascii", "strict", meter).text;}
      catch (error) {
        if (!(error instanceof PythonDecodeError)) throw error;
        meter.checkpoint(1, 192);
        throw new PythonDecodeError("idna", input, error.start, error.end, error.reason, meter, undefined, {context: error});
      }
    }
    const labels: {start: number; end: number}[] = [];
    let start = 0, index = 0;
    for (const point of text) {
      meter.checkpoint();
      if (point === 46 || unicode && (point === 0x3002 || point === 0xff0e || point === 0xff61)) {
        meter.checkpoint(1, 32);
        labels.push({start, end: index});
        start = index + 1;
      }
      index++;
    }
    const trailing = start === text.length || !final && labels.length !== 0;
    if (start !== text.length && final) {
      meter.checkpoint(1, 32);
      labels.push({start, end: text.length});
    }
    const output: number[] = [];
    let consumed = 0;
    for (let labelIndex = 0; labelIndex < labels.length; labelIndex++) {
      const label = labels[labelIndex];
      meter.checkpoint();
      if (labelIndex) {meter.checkpoint(1, 8); output.push(46);}
      try {
        const decoded = decodeIdnaUnicodeLabel(text.slice(BigInt(label.start), BigInt(label.end), null, meter), meter);
        for (const point of decoded) {meter.checkpoint(1, 8); output.push(point);}
      } catch (error) {
        if (!(error instanceof PythonEncodeError || error instanceof PythonDecodeError)) throw error;
        const object = encodeSingleByte(text, "ascii", "backslashreplace", meter);
        const begin = BigInt(consumed) + BigInt(error.start), end = BigInt(consumed) + BigInt(error.end);
        meter.checkpoint(1, 192);
        if (begin < -(1n << 63n) || begin >= (1n << 63n) || end < -(1n << 63n) || end >= (1n << 63n)) {
          throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t", {context: error});
        }
        throw new PythonDecodeError("idna", object, begin, end, error.reason, meter, undefined, {context: error});
      }
      if (consumed) consumed++;
      consumed += label.end - label.start;
    }
    if (trailing) {meter.checkpoint(1, 8); output.push(46); consumed++;}
    // Record, point-string wrapper and two array headers; CodePointString
    // separately admits its owned copy of the point payload.
    meter.checkpoint(output.length, 192 + output.length * 4);
    return {output: new CodePointString(Uint32Array.from(output), meter), consumed};
  } catch (error) {fatal = error instanceof ExecutionLimitError; throw error;}
  finally {if (!fatal) meter.checkpoint();}
}

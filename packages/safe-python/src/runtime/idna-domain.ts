import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";
import {encodeIdnaAsciiLabel} from "./idna-ascii-label.js";
import {decodeIdnaUnicodeLabel} from "./idna-unicode-label.js";
import {decodeSingleByte} from "./single-byte-decode.js";
import {encodeSingleByte} from "./single-byte-encode.js";

function labelRanges(input: Iterable<number>, unicode: boolean, meter: ExecutionMeter): {start: number; end: number}[] {
  const labels: {start: number; end: number}[] = [];
  let start = 0, index = 0;
  for (const point of input) {
    meter.checkpoint();
    if (point === 46 || unicode && (point === 0x3002 || point === 0xff0e || point === 0xff61)) {
      meter.checkpoint(1, 32);
      labels.push({start, end: index});
      start = index + 1;
    }
    index++;
  }
  meter.checkpoint(1, 32);
  labels.push({start, end: index});
  return labels;
}

/** Default whole-domain IDNA operations over owned storage and pinned label
 * kernels. These do not publish the guest module: its mutable dependencies,
 * subtype/buffer dispatch and traceback frames belong to guest execution. */
export function encodeIdnaDomain(input: CodePointString, errors: string, meter: ExecutionMeter): {output: Uint8Array; consumed: number} {
  let fatal = false;
  try {
    meter.checkpoint(1, 64);
    if (errors !== "strict") {
      meter.checkpoint(1, 128 + errors.length * 2);
      throw new PythonRuntimeError("UnicodeError", `Unsupported error handling: ${errors}`);
    }
    if (input.length === 0) {
      meter.checkpoint(0, 96);
      return {output: new Uint8Array(), consumed: 0};
    }
    let ascii: Uint8Array | undefined;
    try {ascii = encodeSingleByte(input, "ascii", "strict", meter);}
    catch (error) {if (!(error instanceof PythonEncodeError)) throw error;}
    if (ascii !== undefined) {
      const labels = labelRanges(ascii, false, meter);
      // The reference checks every interior empty label before checking any
      // overlong label. Combining these passes changes exception precedence.
      for (let index = 0; index < labels.length - 1; index++) {
        meter.checkpoint();
        const {start, end} = labels[index];
        if (start === end) {
          meter.checkpoint(1, 192);
          throw new PythonEncodeError("idna", input, start, start + 1, "label empty");
        }
      }
      for (const {start, end} of labels) {
        meter.checkpoint();
        if (end - start >= 64) {
          meter.checkpoint(1, 192);
          throw new PythonEncodeError("idna", input, start, end, "label too long");
        }
      }
      meter.checkpoint(0, 32);
      return {output: ascii, consumed: input.length};
    }
    const labels = labelRanges(input, true, meter);
    const trailing = labels[labels.length - 1].start === input.length;
    if (trailing) labels.pop();
    const output: number[] = [];
    for (const {start, end} of labels) {
      meter.checkpoint();
      if (output.length) {meter.checkpoint(1, 8); output.push(46);}
      try {
        const encoded = encodeIdnaAsciiLabel(input.slice(BigInt(start), BigInt(end), null, meter), meter);
        for (const byte of encoded) {meter.checkpoint(1, 8); output.push(byte);}
      } catch (error) {
        if (!(error instanceof PythonEncodeError || error instanceof PythonDecodeError)) throw error;
        meter.checkpoint(1, 192);
        throw new PythonEncodeError("idna", input, start + Number(error.start), start + Number(error.end), error.reason, undefined, {context: error});
      }
    }
    if (trailing) {meter.checkpoint(1, 8); output.push(46);}
    // Admit the result record and the new owned typed-array header as well
    // as its payload. The ASCII path reuses an already admitted kernel array.
    meter.checkpoint(output.length, 96 + output.length);
    return {output: Uint8Array.from(output), consumed: input.length};
  } catch (error) {fatal = error instanceof ExecutionLimitError; throw error;}
  finally {if (!fatal) meter.checkpoint();}
}

export function decodeIdnaDomain(input: Uint8Array, errors: string, meter: ExecutionMeter): {output: CodePointString; consumed: number} {
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
    let ace = false;
    for (let index = 0; index + 3 < input.length; index++) {
      meter.checkpoint();
      if ((input[index] === 120 || input[index] === 88) && (input[index + 1] === 110 || input[index + 1] === 78) &&
          input[index + 2] === 45 && input[index + 3] === 45) {ace = true; break;}
    }
    if (!ace) {
      try {
        const output = decodeSingleByte(input, "ascii", "strict", meter).text;
        meter.checkpoint(0, 32);
        return {output, consumed: input.length};
      }
      catch (error) {if (!(error instanceof PythonDecodeError)) throw error;}
    }
    const labels = labelRanges(input, false, meter);
    const trailing = labels[labels.length - 1].start === input.length;
    if (trailing) labels.pop();
    const output: number[] = [];
    for (let index = 0; index < labels.length; index++) {
      const {start, end} = labels[index];
      meter.checkpoint();
      if (index) {meter.checkpoint(1, 8); output.push(46);}
      try {
        const decoded = decodeIdnaUnicodeLabel(input.subarray(start, end), meter);
        for (const point of decoded) {meter.checkpoint(1, 8); output.push(point);}
      } catch (error) {
        if (!(error instanceof PythonEncodeError || error instanceof PythonDecodeError)) throw error;
        meter.checkpoint(1, 192);
        const begin = BigInt(start) + BigInt(error.start), finish = BigInt(start) + BigInt(error.end);
        if (begin < -(1n << 63n) || begin >= (1n << 63n) || finish < -(1n << 63n) || finish >= (1n << 63n)) {
          throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t", {context: error});
        }
        throw new PythonDecodeError("idna", input, begin, finish, error.reason, meter, undefined, {context: error});
      }
    }
    if (trailing) {meter.checkpoint(1, 8); output.push(46);}
    // The point-string constructor charges its copied payload separately.
    meter.checkpoint(output.length, 192 + output.length * 4);
    return {output: new CodePointString(Uint32Array.from(output), meter), consumed: input.length};
  } catch (error) {fatal = error instanceof ExecutionLimitError; throw error;}
  finally {if (!fatal) meter.checkpoint();}
}

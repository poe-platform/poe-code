import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";
import {encodeIdnaAsciiLabel} from "./idna-ascii-label.js";

/** Default IDNA _buffer_encode kernel. The caller retains input after consumed;
 * guest incremental objects own that state and the mutable ToASCII dependency.
 * Unlike whole-domain encoding, every completed ASCII label passes ToASCII. */
export function encodeIdnaBuffer(input: CodePointString, errors: string, final: boolean, meter: ExecutionMeter): {output: Uint8Array; consumed: number} {
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
    const labels: {start: number; end: number}[] = [];
    let start = 0, index = 0;
    for (const point of input) {
      meter.checkpoint();
      if (point === 46 || point === 0x3002 || point === 0xff0e || point === 0xff61) {
        meter.checkpoint(1, 32);
        labels.push({start, end: index});
        start = index + 1;
      }
      index++;
    }
    const trailing = start === input.length || !final && labels.length !== 0;
    if (start !== input.length && final) {
      meter.checkpoint(1, 32);
      labels.push({start, end: input.length});
    }
    const output: number[] = [];
    let consumed = 0;
    for (const label of labels) {
      meter.checkpoint();
      if (consumed) {meter.checkpoint(1, 8); output.push(46); consumed++;}
      try {
        const encoded = encodeIdnaAsciiLabel(input.slice(BigInt(label.start), BigInt(label.end), null, meter), meter);
        for (const byte of encoded) {meter.checkpoint(1, 8); output.push(byte);}
      } catch (error) {
        if (!(error instanceof PythonEncodeError || error instanceof PythonDecodeError)) throw error;
        meter.checkpoint(1, 192);
        throw new PythonEncodeError("idna", input, consumed + Number(error.start), consumed + Number(error.end), error.reason, undefined, {context: error});
      }
      consumed += label.end - label.start;
    }
    if (trailing) {meter.checkpoint(1, 8); output.push(46); consumed++;}
    // The returned record and owned typed-array header exist even when a
    // non-final label produced no bytes. Admit them before publication.
    meter.checkpoint(output.length, 96 + output.length);
    return {output: Uint8Array.from(output), consumed};
  } catch (error) {fatal = error instanceof ExecutionLimitError; throw error;}
  finally {if (!fatal) meter.checkpoint();}
}

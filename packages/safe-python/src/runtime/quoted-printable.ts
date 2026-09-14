import type {ExecutionMeter} from "./execution-budget.js";

const digits = "0123456789ABCDEF";

export interface QuotedPrintableOptions {
  readonly quoteTabs?: boolean;
  readonly isText?: boolean;
  readonly header?: boolean;
}

/** CPython 3.14.7 binascii.b2a_qp byte transform. Guest bindings own buffer
 * acquisition and option truth conversion. The first LF selects the newline
 * convention even in binary mode. See Modules/binascii.c and CPYTHON-LICENSE.txt.
 */
export function encodeQuotedPrintable(input: Uint8Array, options: QuotedPrintableOptions = {}, meter?: ExecutionMeter): Uint8Array {
  meter?.checkpoint();
  const {quoteTabs = false, isText = true, header = false} = options;
  let crlf = false;
  for (let index = 0; index < input.length; index++) {
    meter?.checkpoint();
    if (input[index] === 10) { crlf = index > 0 && input[index - 1] === 13; break; }
  }
  // Run the same state machine to size and fill: trailing whitespace rewriting
  // and header underscores must depend on emitted bytes in both passes.
  let output: Uint8Array | undefined;
  for (let pass = 0; pass < 2; pass++) {
    let written = 0, lineLength = 0, previous = -1;
    const emit = (byte: number): void => {
      if (output !== undefined) output[written] = byte;
      written++;
      previous = byte;
    };
    for (let index = 0; index < input.length; index++) {
      meter?.checkpoint();
      const byte = input[index], next = input[index + 1];
      const quote = byte > 126 || byte === 61 || header && byte === 95 ||
        byte === 46 && lineLength === 0 && (next === undefined || next === 10 || next === 13 || next === 0) ||
        !isText && (byte === 13 || byte === 10) ||
        (byte === 9 || byte === 32) && next === undefined ||
        byte < 33 && byte !== 13 && byte !== 10 && (quoteTabs || byte !== 9 && byte !== 32);
      if (quote) {
        if (lineLength + 3 >= 76) {
          emit(61); if (crlf) emit(13); emit(10); lineLength = 0;
        }
        emit(61); emit(digits.charCodeAt(byte >>> 4)); emit(digits.charCodeAt(byte & 15));
        lineLength += 3;
      } else if (isText && (byte === 10 || byte === 13 && next === 10)) {
        lineLength = 0;
        if (previous === 32 || previous === 9) {
          const whitespace = previous;
          if (output !== undefined) output[written - 1] = 61;
          emit(digits.charCodeAt(whitespace >>> 4)); emit(digits.charCodeAt(whitespace & 15));
        }
        if (crlf) emit(13); emit(10);
        if (byte === 13) index++;
      } else {
        if (next !== undefined && next !== 10 && lineLength + 1 >= 76) {
          emit(61); if (crlf) emit(13); emit(10); lineLength = 0;
        }
        lineLength++;
        emit(header && byte === 32 ? 95 : byte);
      }
    }
    if (output === undefined) {
      meter?.checkpoint(1, 64 + written);
      output = new Uint8Array(written);
    }
  }
  meter?.checkpoint();
  return output!;
}

function hexDigit(byte: number | undefined): number {
  if (byte === undefined) return -1;
  return byte >= 48 && byte <= 57 ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;
}

/** Permissive binascii.a2b_qp decoding, including doubled equals, dangling
 * escapes and CR soft breaks that discard through the next LF. No host text
 * conversion or Unicode tables participate in this byte-only operation. */
export function decodeQuotedPrintable(input: Uint8Array, header = false, meter?: ExecutionMeter): Uint8Array {
  meter?.checkpoint(1, 64 + input.length);
  const output = new Uint8Array(input.length);
  let written = 0;
  for (let index = 0; index < input.length; index++) {
    meter?.checkpoint();
    const byte = input[index];
    if (byte !== 61) {
      output[written++] = header && byte === 95 ? 32 : byte;
      continue;
    }
    const next = input[++index];
    if (next === undefined) break;
    if (next === 10 || next === 13) {
      if (next === 13) {
        while (index < input.length && input[index] !== 10) { meter?.checkpoint(); index++; }
      }
    } else if (next === 61) output[written++] = 61;
    else {
      const high = hexDigit(next), low = hexDigit(input[index + 1]);
      if (high >= 0 && low >= 0) { output[written++] = high * 16 + low; index++; }
      else { output[written++] = 61; index--; }
    }
  }
  if (written === output.length) { meter?.checkpoint(); return output; }
  meter?.checkpoint(written, 64 + written);
  return output.slice(0, written);
}

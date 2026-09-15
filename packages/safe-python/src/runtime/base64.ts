import type {ExecutionMeter} from "./execution-budget.js";
import {BinasciiError} from "./binascii-error.js";
export {BinasciiError} from "./binascii-error.js";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** CPython 3.14.7 binascii.b2a_base64 byte kernel. This encodes one line without
 * wrapping; base64.encodebytes owns its separate 57-byte chunking policy.
 * Guest buffer acquisition and keyword truth conversion precede this kernel.
 * No host Buffer, atob/btoa, locale or Unicode conversion participates. */
export function encodeBase64(input: Uint8Array, newline = true, meter?: ExecutionMeter): Uint8Array {
  const size = Math.ceil(input.length / 3) * 4 + Number(newline);
  // Typed-array storage is owned even when the encoded payload is empty.
  meter?.checkpoint(1, 64 + size);
  const output = new Uint8Array(size);
  let written = 0;
  for (let index = 0; index < input.length; index += 3) {
    meter?.checkpoint();
    const first = input[index], second = input[index + 1] ?? 0, third = input[index + 2] ?? 0;
    output[written++] = alphabet.charCodeAt(first >>> 2);
    output[written++] = alphabet.charCodeAt(((first & 3) << 4) | (second >>> 4));
    output[written++] = index + 1 < input.length ? alphabet.charCodeAt(((second & 15) << 2) | (third >>> 6)) : 61;
    output[written++] = index + 2 < input.length ? alphabet.charCodeAt(third & 63) : 61;
  }
  if (newline) output[written] = 10;
  meter?.checkpoint();
  return output;
}

/** Pinned a2b_base64 state machine. Padding does not terminate permissive
 * decoding: later alphabet bytes continue the current quartet. In strict mode
 * invalid bytes, discontinuous padding and excess padding have distinct error
 * precedence. See CPYTHON-LICENSE.txt and Modules/binascii.c at v3.14.7.
 * Each invocation is independent; an incremental codec must not silently retain
 * partial quartets across calls when the guest library is stateless. */
export function decodeBase64(input: Uint8Array, strict = false, meter?: ExecutionMeter): Uint8Array {
  const capacity = Math.ceil(input.length / 4) * 3;
  meter?.checkpoint(1, 64 + capacity);
  const output = new Uint8Array(capacity);
  let written = 0, position = 0, remainder = 0, padding = 0;
  for (let index = 0; index < input.length; index++) {
    meter?.checkpoint();
    const byte = input[index];
    if (byte === 61) {
      padding++;
      if (position >= 2 && position + padding <= 4 || !strict) continue;
      if (position === 1) break;
      meter?.checkpoint(0, 256);
      throw new BinasciiError(position === 0 && index === 0 ? "Leading padding not allowed" : "Excess padding not allowed");
    }
    const value = byte >= 65 && byte <= 90 ? byte - 65
      : byte >= 97 && byte <= 122 ? byte - 71
      : byte >= 48 && byte <= 57 ? byte + 4
      : byte === 43 ? 62 : byte === 47 ? 63 : -1;
    if (value < 0) {
      if (strict) {
        meter?.checkpoint(0, 256);
        throw new BinasciiError("Only base64 data is allowed");
      }
      continue;
    }
    if (padding && strict) {
      meter?.checkpoint(0, 256);
      throw new BinasciiError(position + padding === 4 ? "Excess data after padding" : "Discontinuous padding not allowed");
    }
    padding = 0;
    if (position === 0) remainder = value;
    else if (position === 1) {
      output[written++] = (remainder << 2) | (value >>> 4);
      remainder = value & 15;
    } else if (position === 2) {
      output[written++] = (remainder << 4) | (value >>> 2);
      remainder = value & 3;
    } else {
      output[written++] = (remainder << 6) | value;
      remainder = 0;
    }
    position = (position + 1) % 4;
  }
  if (position === 1) {
    // Faults own an exception and diagnostic independently of scratch storage.
    // Admit the formatted count before allocating its decimal representation.
    meter?.checkpoint(0, 448);
    throw new BinasciiError(`Invalid base64-encoded string: number of data characters (${Math.floor(written / 3) * 4 + 1}) cannot be 1 more than a multiple of 4`);
  }
  if (position !== 0 && position + padding < 4) {
    meter?.checkpoint(0, 256);
    throw new BinasciiError("Incorrect padding");
  }
  // The returned slice owns separate storage from the decoding scratch array.
  meter?.checkpoint(written + 1, 64 + written);
  return output.slice(0, written);
}

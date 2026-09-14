import {BinasciiError} from "./binascii-error.js";
import type {ExecutionMeter} from "./execution-budget.js";

/** CPython 3.14.7 binascii.b2a_uu byte transform. The guest binding owns
 * buffer acquisition and backtick truth conversion. This is one encoded line;
 * the uu codec separately owns framing, filenames and chunking at 45 bytes.
 * See Modules/binascii.c and CPYTHON-LICENSE.txt. */
export function encodeUu(input: Uint8Array, backtick = false, meter?: ExecutionMeter): Uint8Array {
  meter?.checkpoint();
  if (input.length > 45) {
    meter?.checkpoint(0, 256);
    throw new BinasciiError("At most 45 bytes at once");
  }
  const size = 2 + Math.ceil(input.length / 3) * 4;
  meter?.checkpoint(1, 64 + size);
  const output = new Uint8Array(size);
  output[0] = input.length === 0 && backtick ? 96 : 32 + input.length;
  let written = 1;
  for (let index = 0; index < input.length; index += 3) {
    meter?.checkpoint();
    const group = (input[index] << 16) | ((input[index + 1] ?? 0) << 8) | (input[index + 2] ?? 0);
    for (let shift = 18; shift >= 0; shift -= 6) {
      const digit = (group >>> shift) & 63;
      output[written++] = digit === 0 && backtick ? 96 : 32 + digit;
    }
  }
  output[written] = 10;
  meter?.checkpoint();
  return output;
}

/** The length byte is masked, not validated as a printable character. Missing
 * payload digits and CR/LF contribute zero sextets; only the bytes following
 * the declared output are subject to the stricter trailing-whitespace check.
 * Guest ASCII conversion precedes this byte kernel and never uses host Unicode.
 */
export function decodeUu(input: Uint8Array, meter?: ExecutionMeter): Uint8Array {
  meter?.checkpoint();
  if (input.length === 0) {
    meter?.checkpoint(0, 256);
    throw new BinasciiError("Missing length byte");
  }
  const length = (input[0] - 32) & 63;
  meter?.checkpoint(1, 64 + length);
  const output = new Uint8Array(length);
  let position = 1, written = 0, bits = 0, remainder = 0;
  while (written < length) {
    meter?.checkpoint();
    const byte = input[position++];
    let digit = 0;
    if (byte !== undefined && byte !== 10 && byte !== 13) {
      if (byte < 32 || byte > 96) {
        meter?.checkpoint(0, 256);
        throw new BinasciiError("Illegal char");
      }
      digit = (byte - 32) & 63;
    }
    remainder = (remainder << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[written++] = (remainder >>> bits) & 255;
      remainder &= (1 << bits) - 1;
    }
  }
  for (; position < input.length; position++) {
    meter?.checkpoint();
    const byte = input[position];
    if (byte !== 32 && byte !== 96 && byte !== 10 && byte !== 13) {
      meter?.checkpoint(0, 256);
      throw new BinasciiError("Trailing garbage");
    }
  }
  meter?.checkpoint();
  return output;
}

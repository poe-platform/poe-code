import {BinasciiError} from "./binascii-error.js";
import type {ExecutionMeter} from "./execution-budget.js";

const digits = "0123456789abcdef";

/** CPython 3.14.7 binascii.hexlify byte kernel. The native binding must acquire
 * the buffer and validate the separator and C-int grouping before calling.
 * Separator is a byte (including Latin-1), not a host Unicode conversion.
 * Positive groups count from the right; negative groups count from the left.
 * See Python/pystrhex.c and the repository's CPYTHON-LICENSE.txt. */
export function encodeHexadecimal(input: Uint8Array, separator?: number, group = 1, meter?: ExecutionMeter): Uint8Array {
  const width = separator === undefined ? 0 : Math.abs(group);
  const separators = width === 0 || input.length === 0 ? 0 : Math.floor((input.length - 1) / width);
  meter?.checkpoint(1, 64 + input.length * 2 + separators);
  const output = new Uint8Array(input.length * 2 + separators);
  let written = 0;
  for (let index = 0; index < input.length; index++) {
    meter?.checkpoint();
    if (index > 0 && width !== 0 && (group < 0 ? index : input.length - index) % width === 0) output[written++] = separator!;
    const byte = input[index];
    output[written++] = digits.charCodeAt(byte >>> 4);
    output[written++] = digits.charCodeAt(byte & 15);
  }
  meter?.checkpoint();
  return output;
}

/** binascii.unhexlify consumes exact pairs, accepts both cases and rejects all
 * whitespace. Unlike bytes.fromhex, odd length takes precedence over invalid
 * digits anywhere in the input. Guest ASCII/buffer validation precedes this.
 * Each result owns storage; no host codec or mutable process table is used. */
export function decodeHexadecimal(input: Uint8Array, meter?: ExecutionMeter): Uint8Array {
  meter?.checkpoint();
  if (input.length % 2 !== 0) {
    meter?.checkpoint(0, 256);
    throw new BinasciiError("Odd-length string");
  }
  meter?.checkpoint(1, 64 + input.length / 2);
  const output = new Uint8Array(input.length / 2);
  for (let index = 0; index < input.length; index += 2) {
    meter?.checkpoint();
    let value = 0;
    for (let offset = 0; offset < 2; offset++) {
      const byte = input[index + offset];
      const digit = byte >= 48 && byte <= 57 ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;
      if (digit < 0) {
        meter?.checkpoint(0, 256);
        throw new BinasciiError("Non-hexadecimal digit found");
      }
      value = value * 16 + digit;
    }
    output[index / 2] = value;
  }
  meter?.checkpoint();
  return output;
}

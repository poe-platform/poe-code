import type {ExecutionMeter} from "./execution-budget.js";
import {stringprepB2, stringprepB3, stringprepTransitions} from "./stringprep-table-data.js";

/** RFC 3454 table membership, using CPython's pinned Unicode 3.2 properties.
 * These are internal code-point kernels; guest argument/type validation and
 * mutable stringprep module tables belong to the interpreter bindings. */
export const stringprepTableBits = Object.freeze({
  a1: 1, b1: 2, c11: 4, c12: 8, c11_c12: 16, c21: 32, c22: 64,
  c21_c22: 128, c3: 256, c4: 512, c5: 1024, c6: 2048, c7: 4096,
  c8: 8192, c9: 16384, d1: 32768, d2: 65536
});

/** Return all memberships for an already validated Python code point.
 * The transition table includes U+0000 and covers through U+10FFFF. */
export function stringprepMask(point: number, meter?: ExecutionMeter): number {
  meter?.checkpoint();
  let low = 0, high = stringprepTransitions.length / 2;
  while (low < high) {
    meter?.checkpoint();
    const middle = Math.floor((low + high) / 2);
    if (stringprepTransitions[middle * 2] <= point) low = middle + 1;
    else high = middle;
  }
  meter?.checkpoint();
  return stringprepTransitions[(low - 1) * 2 + 1];
}

/** B2/B3 map one code point, including surrogates, to owned output storage.
 * CPython's B3 uses modern str.lower after the RFC exceptions; B2 additionally
 * uses Unicode 3.2 NFKC. Capture that mixed-version contract in pinned tables,
 * rather than calling the host's lowercasing or normalization implementation. */
export function stringprepMapping(table: "b2" | "b3", point: number, meter?: ExecutionMeter): Uint32Array {
  meter?.checkpoint();
  const rows = table === "b2" ? stringprepB2 : stringprepB3;
  let low = 0, high = rows.length;
  while (low < high) {
    meter?.checkpoint();
    const middle = Math.floor((low + high) / 2), row = rows[middle];
    if (row[0] < point) low = middle + 1;
    else high = middle;
  }
  const row = rows[low]?.[0] === point ? rows[low] : undefined;
  const length = row === undefined ? 1 : row.length - 1;
  meter?.checkpoint(1, length * 4);
  const output = new Uint32Array(length);
  for (let index = 0; index < length; index++) {
    meter?.checkpoint();
    output[index] = row === undefined ? point : row[index + 1];
  }
  meter?.checkpoint();
  return output;
}

import type { PrintfBinary } from "./printf-float.js";

// Use the leading-nibble spelling captured from GNU/Linux long-double printf.
export function printfHex(number: number, precision: number | undefined, alternate: boolean, exact?: PrintfBinary): string {
  const magnitude = Math.abs(number);
  if (exact ? exact.significand === 0n : magnitude === 0) return `0x0${precision ? "." + "0".repeat(precision) : alternate ? "." : ""}p+0`;
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, magnitude);
  const encoded = bits.getBigUint64(0);
  const field = Number((encoded >> 52n) & 2047n);
  const significand = exact?.significand ?? ((encoded & ((1n << 52n) - 1n)) | (field ? 1n << 52n : 0n));
  const top = significand.toString(2).length - 1;
  let exponent = (exact?.power ?? (field ? field - 1023 - 52 : -1074)) + top - 3;
  const digits = precision ?? 15;
  const shift = top - 3 - digits * 4;
  let rounded: bigint;
  if (shift > 0) {
    rounded = significand >> BigInt(shift);
    const remainder = significand - (rounded << BigInt(shift));
    const half = 1n << BigInt(shift - 1);
    if (remainder > half || remainder === half && (rounded & 1n) !== 0n) rounded++;
  } else rounded = significand << BigInt(-shift);
  if (rounded >= 16n << BigInt(digits * 4)) { rounded >>= 4n; exponent += 4; }
  const hex = rounded.toString(16).padStart(digits + 1, "0");
  const fraction = precision === undefined ? hex.slice(1).replace(/0+$/u, "") : hex.slice(1);
  return `0x${hex[0]}${fraction || alternate ? "." + fraction : ""}p${exponent >= 0 ? "+" : ""}${exponent}`;
}

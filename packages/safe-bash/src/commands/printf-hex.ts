import { printfBinary, type PrintfBinary } from "./printf-float.js";

// Use the leading-nibble spelling captured from GNU/Linux long-double printf.
export function printfHex(number: number | PrintfBinary, precision: number | undefined, alternate: boolean): string {
  const { significand, exponent: power } = printfBinary(number);
  if (significand === 0n) return `0x0${precision ? "." + "0".repeat(precision) : alternate ? "." : ""}p+0`;
  const top = significand.toString(2).length - 1;
  let exponent = Math.max(power + top - 3, -16385);
  const digits = precision ?? Math.ceil(Math.max(0, exponent - power) / 4);
  const shift = exponent - power - digits * 4;
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

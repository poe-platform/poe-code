import { CsvkitBlocked } from "../errors.js";

/** Compare canonical Decimal strings without binary floats or exponent-sized allocations. */
export function compareDecimals(left: string, right: string, step: () => void): number {
  if (left.includes("NaN") || right.includes("NaN")) throw new CsvkitBlocked("Decimal NaN ordering traps");
  if (left === right) return 0;
  if (left === "Infinity" || right === "-Infinity") return 1;
  if (left === "-Infinity" || right === "Infinity") return -1;
  const parts = (text: string) => {
    const [coefficient, exponent] = text.split("E");
    const unsigned = coefficient!.startsWith("-") ? coefficient!.slice(1) : coefficient!;
    const [integer, fraction = ""] = unsigned.split(".");
    const digits = (integer! + fraction).replace(/^0+/, "");
    return { digits, negative: digits.length > 0 && text.startsWith("-"), magnitude: digits.length + Number(exponent ?? 0) - fraction.length };
  };
  const a = parts(left); const b = parts(right);
  if (!a.digits && !b.digits) return 0;
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const sign = a.negative ? -1 : 1;
  if (!a.digits || !b.digits) return (!a.digits ? -1 : 1) * sign;
  if (a.magnitude !== b.magnitude) return (a.magnitude < b.magnitude ? -1 : 1) * sign;
  for (let index = 0; index < Math.max(a.digits.length, b.digits.length); index++) {
    step();
    const x = a.digits[index] ?? "0"; const y = b.digits[index] ?? "0";
    if (x !== y) return (x < y ? -1 : 1) * sign;
  }
  return 0;
}

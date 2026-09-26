/** C-locale %g, rounding the binary64 rational once at the writer's precision. */
export function gnumericNumber(value: number, shortest = false, precision = 17): string {
  if (shortest || value === 0) return String(value);
  const absolute = Math.abs(value);
  let exponent = Number(absolute.toExponential().split("e")[1]);
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, absolute);
  const bits = view.getBigUint64(0), power = Number((bits >> 52n) & 2047n);
  let numerator = (bits & ((1n << 52n) - 1n)) + (power ? 1n << 52n : 0n);
  let denominator = 1n;
  const shift = power ? power - 1075 : -1074;
  if (shift >= 0) numerator <<= BigInt(shift); else denominator <<= BigInt(-shift);
  const decimalShift = precision - 1 - exponent;
  if (decimalShift >= 0) numerator *= 10n ** BigInt(decimalShift); else denominator *= 10n ** BigInt(-decimalShift);
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || remainder * 2n === denominator && rounded % 2n === 1n) rounded++;
  let digits = rounded.toString();
  if (digits.length > precision) { exponent++; digits = digits.slice(0, precision); }
  while (digits.endsWith("0")) digits = digits.slice(0, -1);
  let text: string;
  if (exponent < -4 || exponent >= precision) text = digits[0] + (digits.length > 1 ? "." + digits.slice(1) : "") +
    `e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
  else if (exponent < 0) text = "0." + "0".repeat(-exponent - 1) + digits;
  else if (digits.length <= exponent + 1) text = digits + "0".repeat(exponent + 1 - digits.length);
  else text = digits.slice(0, exponent + 1) + "." + digits.slice(exponent + 1);
  return (value < 0 ? "-" : "") + text;
}

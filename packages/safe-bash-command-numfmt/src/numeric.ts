export const signedMaximum = (1n << 63n) - 1n;
export type Rounding = "up" | "down" | "from-zero" | "towards-zero" | "nearest";
export interface Binary { coefficient: bigint; exponent: number; negativeZero?: boolean }

function bitLength(n: bigint): number {
  if (n >= 0x8000000000000000n && n <= 0xffffffffffffffffn) return 64;
  if (n <= 0x7fffffffn) return 32 - Math.clz32(Number(n));
  if (n <= 0xffffffffffffffffn) return 64 - Math.clz32(Number(n >> 32n));
  if (n >= (1n << 126n) && n < (1n << 128n)) return n >= (1n << 127n) ? 128 : 127;
  return n.toString(2).length;
}

export function binary(numerator: bigint, denominator = 1n, exponent = 0): Binary {
  if (!numerator) return { coefficient: 0n, exponent: 0 };
  const negative = numerator < 0n !== denominator < 0n;
  numerator = numerator < 0n ? -numerator : numerator;
  denominator = denominator < 0n ? -denominator : denominator;
  let shift = bitLength(numerator) - bitLength(denominator);
  if (shift >= 0 ? numerator < denominator << BigInt(shift) : numerator << BigInt(-shift) < denominator) shift--;
  const target = Math.max(shift + exponent - 63, -16445);
  const adjustment = exponent - target;
  if (adjustment >= 0) numerator <<= BigInt(adjustment);
  else denominator <<= BigInt(-adjustment);
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || remainder * 2n === denominator && rounded % 2n !== 0n) rounded++;
  if (target > 16320 || target === 16320 && rounded >= 1n << 64n) return { coefficient: negative ? -1n : 1n, exponent: Infinity };
  return { coefficient: negative ? -rounded : rounded, exponent: target, negativeZero: negative && rounded === 0n };
}

export function add(left: Binary, right: Binary): Binary {
  if (!left.coefficient && !right.coefficient) {
    return { coefficient: 0n, exponent: 0, negativeZero: left.negativeZero === true && right.negativeZero === true };
  }
  if (!left.coefficient) return { ...right };
  if (!right.coefficient) return { ...left };
  const exponent = Math.min(left.exponent, right.exponent);
  const result = binary((left.coefficient << BigInt(left.exponent - exponent)) + (right.coefficient << BigInt(right.exponent - exponent)), 1n, exponent);
  if (!result.coefficient) result.negativeZero = left.negativeZero === true && right.negativeZero === true;
  return result;
}

export function multiply(left: Binary, right: Binary): Binary {
  if (!left.coefficient || !right.coefficient) return { coefficient: 0n, exponent: 0, negativeZero: (left.coefficient < 0n || left.negativeZero === true) !== (right.coefficient < 0n || right.negativeZero === true) };
  return binary(left.coefficient * right.coefficient, 1n, left.exponent + right.exponent);
}

export function divide(left: Binary, right: Binary): Binary {
  if (!left.coefficient || right.exponent === Infinity) return { coefficient: 0n, exponent: 0, negativeZero: (left.coefficient < 0n || left.negativeZero === true) !== (right.coefficient < 0n || right.negativeZero === true) };
  return binary(left.coefficient, right.coefficient, left.exponent - right.exponent);
}

export function absolute(value: Binary): Binary {
  return { ...value, coefficient: value.coefficient < 0n ? -value.coefficient : value.coefficient, negativeZero: false };
}

export function negate(value: Binary): Binary {
  return { ...value, coefficient: -value.coefficient, negativeZero: value.coefficient === 0n && !value.negativeZero };
}

export function integer(value: Binary): bigint {
  const magnitude = value.coefficient < 0n ? -value.coefficient : value.coefficient;
  const result = value.exponent >= 0 ? magnitude << BigInt(value.exponent) : magnitude >> BigInt(-value.exponent);
  return value.coefficient < 0n ? -result : result;
}

export function compare(left: Binary, right: Binary): number {
  const lc = left.coefficient, rc = right.coefficient;
  if (lc === 0n && rc === 0n) return 0;
  if (lc <= 0n && rc >= 0n) return -1;
  if (lc >= 0n && rc <= 0n) return 1;
  const diffExp = left.exponent - right.exponent;
  if (diffExp === 0) return lc < rc ? -1 : lc > rc ? 1 : 0;
  if (diffExp > 0) {
    if (diffExp > 128) return lc > 0n ? 1 : -1;
    const scaledL = lc << BigInt(diffExp);
    return scaledL < rc ? -1 : scaledL > rc ? 1 : 0;
  }
  if (diffExp < -128) return rc > 0n ? -1 : 1;
  const scaledR = rc << BigInt(-diffExp);
  return lc < scaledR ? -1 : lc > scaledR ? 1 : 0;
}

const BINARY_1: Binary = binary(1n);
export const BINARY_10: Binary = binary(10n);
export const BINARY_1000: Binary = binary(1000n);
export const BINARY_1024: Binary = binary(1024n);
const BINARY_HALF_POS: Binary = binary(1n, 2n);
const BINARY_HALF_NEG: Binary = binary(-1n, 2n);

export function power(base: number, exponent: number): Binary {
  if (exponent === 0) return BINARY_1;
  if (exponent === 1) return base === 10 ? BINARY_10 : base === 1000 ? BINARY_1000 : base === 1024 ? BINARY_1024 : binary(BigInt(base));
  if (base === 10 && exponent > 4933) return { coefficient: 1n, exponent: Infinity };
  let result = BINARY_1;
  const factor = base === 10 ? BINARY_10 : base === 1000 ? BINARY_1000 : base === 1024 ? BINARY_1024 : binary(BigInt(base));
  for (let index = 0; index < exponent; index++) {
    result = multiply(result, factor);
    if (result.exponent === Infinity) break;
  }
  return result;
}

export function round(value: Binary, method: Rounding): Binary {
  if (value.exponent < -1) {
    let rounded = integer(value);
    if (method === "nearest") rounded = integer(add(value, value.coefficient < 0n ? BINARY_HALF_NEG : BINARY_HALF_POS));
    else {
      const mag = value.coefficient < 0n ? -value.coefficient : value.coefficient;
      const shift = -value.exponent;
      const hasFraction = shift >= 128 ? mag !== 0n : (mag & ((1n << BigInt(shift)) - 1n)) !== 0n;
      if (hasFraction) {
        if (method === "from-zero") rounded += value.coefficient < 0n ? -1n : 1n;
        else if (method === "up" && value.coefficient > 0n) rounded++;
        else if (method === "down" && value.coefficient < 0n) rounded--;
      }
    }
    return binary(rounded);
  }
  const maximum = binary(signedMaximum);
  const multiple = integer(divide(value, maximum));
  const high = multiply(maximum, binary(multiple));
  const low = add(value, { ...high, coefficient: -high.coefficient });
  let rounded = integer(low);
  if (method === "nearest") rounded = integer(add(low, binary(low.coefficient < 0n ? -1n : 1n, 2n)));
  else if (compare(low, binary(rounded)) !== 0) {
    if (method === "from-zero") rounded += low.coefficient < 0n ? -1n : 1n;
    else if (method === "up" && low.coefficient > 0n) rounded++;
    else if (method === "down" && low.coefficient < 0n) rounded--;
  }
  return add(high, binary(rounded));
}

function decimalRounded(value: Binary, precision: number): bigint {
  let numerator = absolute(value).coefficient;
  let denominator = 1n;
  if (precision >= 0) numerator *= 10n ** BigInt(precision);
  else denominator *= 10n ** BigInt(-precision);
  if (value.exponent >= 0) numerator <<= BigInt(value.exponent);
  else denominator <<= BigInt(-value.exponent);
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || remainder * 2n === denominator && rounded % 2n !== 0n) rounded++;
  return rounded;
}

export function fixed(value: Binary, precision: number, grouped = false): string {
  const digits = decimalRounded(value, precision).toString().padStart(precision + 1, "0");
  let integral = precision ? digits.slice(0, -precision) : digits;
  if (grouped) {
    const parts: string[] = [];
    while (integral.length > 3) { parts.unshift(integral.slice(-3)); integral = integral.slice(0, -3); }
    parts.unshift(integral);
    integral = parts.join(",");
  }
  return (value.coefficient < 0n || value.negativeZero ? "-" : "") + integral + (precision ? `.${digits.slice(-precision)}` : "");
}

export function general(value: Binary, uppercase = false): string {
  if (!value.coefficient) return value.negativeZero ? "-0" : "0";
  const magnitude = absolute(value);
  let numerator = magnitude.coefficient;
  let denominator = 1n;
  if (value.exponent >= 0) numerator <<= BigInt(value.exponent);
  else denominator <<= BigInt(-value.exponent);
  let decimalExponent = numerator.toString().length - denominator.toString().length;
  if (decimalExponent >= 0 ? numerator < denominator * 10n ** BigInt(decimalExponent) : numerator * 10n ** BigInt(-decimalExponent) < denominator) decimalExponent--;
  let significant = decimalRounded(magnitude, 5 - decimalExponent).toString();
  if (significant.length > 6) { decimalExponent++; significant = decimalRounded(magnitude, 5 - decimalExponent).toString(); }
  let text: string;
  if (decimalExponent < -4 || decimalExponent >= 6) {
    text = significant[0] + "." + significant.slice(1);
    while (text.endsWith("0")) text = text.slice(0, -1);
    if (text.endsWith(".")) text = text.slice(0, -1);
    text += `${uppercase ? "E" : "e"}${decimalExponent < 0 ? "-" : "+"}${Math.abs(decimalExponent).toString().padStart(2, "0")}`;
  } else {
    text = fixed(magnitude, Math.max(0, 5 - decimalExponent));
    if (text.includes(".")) { while (text.endsWith("0")) text = text.slice(0, -1); if (text.endsWith(".")) text = text.slice(0, -1); }
  }
  return (value.coefficient < 0n ? "-" : "") + text;
}


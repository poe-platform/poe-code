export interface PrintfBinary {
  significand: bigint;
  exponent: number;
  negative: boolean;
}

interface PrintfFloat {
  value: number | PrintfBinary;
  binary?: PrintfBinary;
  special?: string;
  error?: string;
}

// Keep parsed operands at long-double precision and scale without converting
// them through a JavaScript number. Quoted character operands are numbers.
export function printfBinary(value: number | PrintfBinary): PrintfBinary {
  if (typeof value !== "number") return value;
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, Math.abs(value));
  const word = bits.getBigUint64(0);
  const field = Number(word >> 52n);
  return {
    significand: (word & ((1n << 52n) - 1n)) | (field ? 1n << 52n : 0n),
    exponent: (field || 1) - 1023 - 52,
    negative: value < 0 || Object.is(value, -0),
  };
}

function extendedFloat(significand: bigint, exponent: number, radix: 2 | 10, negative: boolean): PrintfFloat | undefined {
  if (significand === 0n) return { value: negative ? -0 : 0 };
  const order = significand.toString(radix).length - 1 + exponent;
  // Bound powers before allocation, including operands with enormous exponents.
  if (order > (radix === 2 ? 16383 : 4932)) return undefined;
  if (order < (radix === 2 ? -16446 : -4951)) return { value: negative ? -0 : 0 };
  let numerator = significand * BigInt(radix) ** BigInt(Math.max(0, exponent));
  let denominator = BigInt(radix) ** BigInt(Math.max(0, -exponent));
  let top = numerator.toString(2).length - denominator.toString(2).length;
  if (top >= 0 ? numerator < denominator << BigInt(top) : numerator << BigInt(-top) < denominator) top--;
  if (top > 16383) return undefined;
  // x86-64 long double has 64 significand bits and subnormals down to 2^-16445.
  const power = Math.max(top - 63, -16445);
  if (power < 0) numerator <<= BigInt(-power);
  else denominator <<= BigInt(power);
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || remainder * 2n === denominator && (rounded & 1n) !== 0n) rounded++;
  if (rounded === 0n) return { value: negative ? -0 : 0 };
  if (power + rounded.toString(2).length - 1 > 16383) return undefined;
  const value = Number(rounded) * 2 ** power * (negative ? -1 : 1);
  const binary = { significand: rounded, exponent: power, negative };
  return {
    value: Number.isFinite(value) && value !== 0 ? value : binary,
    binary,
  };
}

// Parse the C numeric prefix while retaining trailing-input diagnostics.
export function parsePrintfFloat(operand: string): PrintfFloat | undefined {
  let start = 0;
  while (start < operand.length && " \t\n\r\v\f".includes(operand[start]!)) start++;
  let end = operand.length;
  while (end > start && " \t\n\r\v\f".includes(operand[end - 1]!)) end--;
  const token = operand.slice(start, end).toLowerCase();
  if (token.length > 4096) return undefined;
  const negative = token.startsWith("-");
  const magnitude = token.startsWith("+") || negative ? token.slice(1) : token;
  const converted = (value: number | PrintfBinary, end: number, special?: string, error?: string, binary?: PrintfBinary): PrintfFloat => ({
    value, ...(binary === undefined ? {} : { binary }), ...(special === undefined ? {} : { special }),
    ...(end < magnitude.length || operand.length > start + token.length ? { error: "invalid number" } : error === undefined ? {} : { error }),
  });
  if (magnitude.startsWith("inf")) {
    return converted(negative ? -Infinity : Infinity, magnitude.startsWith("infinity") ? 8 : 3, (negative ? "-" : "") + "inf");
  }
  if (magnitude.startsWith("nan")) {
    let end = 3;
    if (magnitude[end] === "(") {
      let offset = end + 1;
      while (offset < magnitude.length && "abcdefghijklmnopqrstuvwxyz0123456789_".includes(magnitude[offset]!)) offset++;
      if (magnitude[offset] === ")") end = offset + 1;
    }
    return converted(NaN, end, (negative ? "-" : "") + "nan");
  }
  const hexadecimal = magnitude.startsWith("0x") && (
    "0123456789abcdef".includes(magnitude[2] ?? "!") || magnitude[2] === "." && "0123456789abcdef".includes(magnitude[3] ?? "!")
  );
  if (!hexadecimal) {
    let offset = 0, digits = 0;
    while (offset < magnitude.length && "0123456789".includes(magnitude[offset]!)) { offset++; digits++; }
    if (magnitude[offset] === ".") {
      offset++;
      while (offset < magnitude.length && "0123456789".includes(magnitude[offset]!)) { offset++; digits++; }
    }
    if (!digits) return undefined;
    const significandEnd = offset;
    let exponent = 0;
    if (magnitude[offset] === "e") {
      const exponentStart = offset++;
      const numberStart = offset;
      if (magnitude[offset] === "+" || magnitude[offset] === "-") offset++;
      const firstDigit = offset;
      while (offset < magnitude.length && "0123456789".includes(magnitude[offset]!)) offset++;
      if (offset === firstDigit) offset = exponentStart;
      else exponent = Number(magnitude.slice(numberStart, offset));
    }
    const parts = magnitude.slice(0, significandEnd).split(".");
    const extended = extendedFloat(BigInt(parts.join("")), exponent - (parts[1]?.length ?? 0), 10, negative);
    return extended === undefined ? undefined : converted(extended.value, offset, extended.special, extended.error, extended.binary);
  }
  let offset = 2, digits = "", fractionDigits = 0, point = false;
  while (offset < magnitude.length) {
    const character = magnitude[offset]!;
    if ("0123456789abcdef".includes(character)) {
      digits += character;
      if (point) fractionDigits++;
    } else if (character === "." && !point) point = true;
    else break;
    offset++;
  }
  let exponent = 0;
  if (magnitude[offset] === "p") {
    const exponentStart = offset++;
    const numberStart = offset;
    if (magnitude[offset] === "+" || magnitude[offset] === "-") offset++;
    const firstDigit = offset;
    while (offset < magnitude.length && "0123456789".includes(magnitude[offset]!)) offset++;
    if (offset === firstDigit) offset = exponentStart;
    else exponent = Number(magnitude.slice(numberStart, offset));
  }
  const significand = BigInt("0x" + digits);
  if (significand === 0n) return converted(negative ? -0 : 0, offset);
  const scale = exponent - fractionDigits * 4;
  const extended = extendedFloat(significand, scale, 2, negative);
  return extended === undefined ? undefined : converted(extended.value, offset, extended.special, extended.error, extended.binary);
}

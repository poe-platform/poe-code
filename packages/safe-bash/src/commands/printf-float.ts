export interface PrintfBinary { significand: bigint; power: number }

// Round an exact rational to the Linux x86-64 long-double significand.
function binary(numerator: bigint, denominator: bigint, power = 0): PrintfBinary {
  if (numerator === 0n) return { significand: 0n, power: 0 };
  let top = numerator.toString(2).length - denominator.toString(2).length;
  if (top >= 0 ? numerator < denominator << BigInt(top) : numerator << BigInt(-top) < denominator) top--;
  const shift = 63 - top;
  if (shift >= 0) numerator <<= BigInt(shift);
  else denominator <<= BigInt(-shift);
  let significand = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || remainder * 2n === denominator && significand % 2n !== 0n) significand++;
  return { significand, power: power - shift };
}

// Parse the C numeric prefix while retaining trailing-input diagnostics.
export function parsePrintfFloat(operand: string): { value: number; binary?: PrintfBinary; special?: string; error?: string } | undefined {
  let start = 0;
  while (start < operand.length && " \t\n\r\v\f".includes(operand[start]!)) start++;
  let end = operand.length;
  while (end > start && " \t\n\r\v\f".includes(operand[end - 1]!)) end--;
  const token = operand.slice(start, end).toLowerCase();
  if (token.length > 4096) return undefined;
  const negative = token.startsWith("-");
  const magnitude = token.startsWith("+") || negative ? token.slice(1) : token;
  const converted = (value: number, end: number, special?: string, exact?: PrintfBinary) => ({
    value, ...(exact === undefined ? {} : { binary: exact }), ...(special === undefined ? {} : { special }), ...(end < magnitude.length || operand.length > start + token.length ? { error: "invalid number" } : {}),
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
    if (magnitude[offset] === "e") {
      const exponentStart = offset++;
      if (magnitude[offset] === "+" || magnitude[offset] === "-") offset++;
      const firstDigit = offset;
      while (offset < magnitude.length && "0123456789".includes(magnitude[offset]!)) offset++;
      if (offset === firstDigit) offset = exponentStart;
    }
    const value = Number((negative ? "-" : "") + magnitude.slice(0, offset));
    if (!Number.isFinite(value)) return undefined;
    // Keep the existing exponent-range policy, including signed underflow.
    if (value === 0) return converted(value, offset);
    const prefix = magnitude.slice(0, offset);
    const [mantissa, exponent = "0"] = prefix.split("e");
    const [whole, fraction = ""] = mantissa!.split(".");
    const coefficient = BigInt(whole! + fraction);
    const power = Number(exponent) - fraction.length;
    const exact = power >= 0 ? binary(coefficient * 10n ** BigInt(power), 1n)
      : binary(coefficient, 10n ** BigInt(-power));
    return converted(value, offset, undefined, exact);
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
  const bits = significand.toString(2).length;
  const scale = exponent - fractionDigits * 4;
  const top = bits - 1 + scale;
  if (top > 1023) return undefined;
  if (top < -1075) return converted(negative ? -0 : 0, offset);
  const shift = Math.max(bits - 53, -1074 - scale);
  let rounded = significand;
  if (shift > 0) {
    rounded >>= BigInt(shift);
    const remainder = significand - (rounded << BigInt(shift));
    const half = 1n << BigInt(shift - 1);
    if (remainder > half || remainder === half && (rounded & 1n) !== 0n) rounded++;
  }
  const value = Number(rounded) * 2 ** (scale + Math.max(0, shift)) * (negative ? -1 : 1);
  return Number.isFinite(value) ? converted(value, offset, undefined, binary(significand, 1n, scale)) : undefined;
}

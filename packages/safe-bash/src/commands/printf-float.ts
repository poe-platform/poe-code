// Parse the C numeric prefix while retaining trailing-input diagnostics.
export function parsePrintfFloat(operand: string): { value: number; special?: string; error?: string } | undefined {
  let start = 0;
  while (start < operand.length && " \t\n\r\v\f".includes(operand[start]!)) start++;
  let end = operand.length;
  while (end > start && " \t\n\r\v\f".includes(operand[end - 1]!)) end--;
  const token = operand.slice(start, end).toLowerCase();
  if (token.length > 4096) return undefined;
  const negative = token.startsWith("-");
  const magnitude = token.startsWith("+") || negative ? token.slice(1) : token;
  const converted = (value: number, end: number, special?: string) => ({
    value, ...(special === undefined ? {} : { special }), ...(end < magnitude.length || operand.length > start + token.length ? { error: "invalid number" } : {}),
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
    return Number.isFinite(value) ? converted(value, offset) : undefined;
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
  return Number.isFinite(value) ? converted(value, offset) : undefined;
}

// Parse C floating operands without a host libc or shell fallback.
export function parsePrintfFloat(operand: string): { value: number; special?: string } | undefined {
  const token = operand.trim().toLowerCase();
  if (token.length > 4096) return undefined;
  const negative = token.startsWith("-");
  const magnitude = token.startsWith("+") || negative ? token.slice(1) : token;
  const payload = magnitude.startsWith("nan(") && magnitude.endsWith(")") ? magnitude.slice(4, -1) : undefined;
  const nan = magnitude === "nan" || payload !== undefined && [...payload].every(char => "abcdefghijklmnopqrstuvwxyz0123456789_".includes(char));
  if (nan || magnitude === "inf" || magnitude === "infinity") {
    return { value: nan ? NaN : negative ? -Infinity : Infinity, special: (negative ? "-" : "") + (nan ? "nan" : "inf") };
  }
  if (!magnitude.startsWith("0x")) {
    const value = Number(operand);
    return Number.isFinite(value) ? { value } : undefined;
  }
  let offset = 2;
  let digits = "";
  let fractionDigits = 0;
  let point = false;
  while (offset < magnitude.length) {
    const char = magnitude[offset]!;
    if ("0123456789abcdef".includes(char)) {
      digits += char;
      if (point) fractionDigits++;
    } else if (char === "." && !point) point = true;
    else break;
    offset++;
  }
  if (!digits) return undefined;
  let exponent = 0;
  if (offset < magnitude.length) {
    if (magnitude[offset++] !== "p") return undefined;
    const start = offset;
    if (magnitude[offset] === "+" || magnitude[offset] === "-") offset++;
    const firstDigit = offset;
    while (offset < magnitude.length && "0123456789".includes(magnitude[offset]!)) offset++;
    if (offset === firstDigit || offset !== magnitude.length) return undefined;
    exponent = Number(magnitude.slice(start));
  }
  const significand = BigInt("0x" + digits);
  if (significand === 0n) return { value: negative ? -0 : 0 };
  const bits = significand.toString(2).length;
  const scale = exponent - fractionDigits * 4;
  const top = bits - 1 + scale;
  if (top > 1023) return undefined;
  if (top < -1075) return { value: negative ? -0 : 0 };
  // Round once to binary64, including the fixed subnormal quantum.
  const shift = Math.max(bits - 53, -1074 - scale);
  let rounded = significand;
  if (shift > 0) {
    rounded >>= BigInt(shift);
    const remainder = significand - (rounded << BigInt(shift));
    const half = 1n << BigInt(shift - 1);
    if (remainder > half || remainder === half && (rounded & 1n) !== 0n) rounded++;
  }
  const value = Number(rounded) * 2 ** (scale + Math.max(0, shift)) * (negative ? -1 : 1);
  return Number.isFinite(value) ? { value } : undefined;
}

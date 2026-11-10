export function parseFilterFloat(source: string): number {
  const text = source.trimStart().toLowerCase();
  const signed = text[0] === "+" || text[0] === "-";
  let offset = signed ? 1 : 0;
  if (!text.startsWith("0x", offset)) return Number.parseFloat(source);
  offset += 2;
  let value = 0;
  let digits = 0;
  let fractionDigits = 0;
  let fraction = false;
  for (; offset < text.length; offset++) {
    const digit = "0123456789abcdef".indexOf(text[offset]!);
    if (digit >= 0) {
      value = value * 16 + digit;
      digits++;
      if (fraction) fractionDigits++;
    } else if (text[offset] === "." && !fraction) fraction = true;
    else break;
  }
  if (!digits) return NaN;
  value /= 16 ** fractionDigits;
  if (text[offset] === "p") {
    const exponent = Number.parseInt(text.slice(offset + 1), 10);
    if (!Number.isNaN(exponent)) value *= 2 ** exponent;
  }
  return text[0] === "-" ? -value : value;
}

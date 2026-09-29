import { decimalZeroes, integerWhitespace, nonprintingRanges } from "../unicode-profile.js";

export function repr(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let text = quote;
  for (const char of value) {
    if (char === quote || char === "\\") text += "\\" + char;
    else if (char === "\n") text += "\\n";
    else if (char === "\r") text += "\\r";
    else if (char === "\t") text += "\\t";
    else {
      const codepoint = char.codePointAt(0)!;
      if (nonprintingRanges.some(([start, end]) => codepoint >= start && codepoint <= end)) {
        const width = codepoint <= 255 ? 2 : codepoint <= 65535 ? 4 : 8;
        text += "\\" + (width === 2 ? "x" : width === 4 ? "u" : "U") + codepoint.toString(16).padStart(width, "0");
      } else text += char;
    }
  }
  return text + quote;
}

export function integer(text: string, maxDigits = 4300): number | bigint | undefined {
  const characters = Array.from(text);
  let start = 0;
  let end = characters.length;
  while (start < end && integerWhitespace.includes(characters[start]!.codePointAt(0)!)) start++;
  while (end > start && integerWhitespace.includes(characters[end - 1]!.codePointAt(0)!)) end--;
  const value = characters.slice(start, end).join("");
  let offset = value[0] === "+" || value[0] === "-" ? 1 : 0;
  let digits = "";
  let previousDigit = false;
  const payload = Array.from(value.slice(offset));
  for (offset = 0; offset < payload.length; offset++) {
    const char = payload[offset]!;
    const codepoint = char.codePointAt(0)!;
    const zero = decimalZeroes.find(zero => codepoint >= zero && codepoint <= zero + 9);
    if (zero !== undefined) { digits += String(codepoint - zero); previousDigit = true; }
    else if (char === "_" && previousDigit && offset + 1 < payload.length) previousDigit = false;
    else return undefined;
  }
  // Frozen CPython sys.int_info.default_max_str_digits, including leading zeroes.
  if (!digits || !previousDigit || digits.length > maxDigits) return undefined;
  const big = BigInt((value[0] === "-" ? "-" : "") + digits);
  const number = Number(big);
  return Number.isSafeInteger(number) ? number : big;
}

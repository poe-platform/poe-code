/** Unicode 13.0 Nd zeroes, matching the pinned Python 3.9 reference runtime. */
const decimalZeroes = [
  48, 1632, 1776, 1984, 2406, 2534, 2662, 2790, 2918, 3046, 3174, 3302,
  3430, 3558, 3664, 3792, 3872, 4160, 4240, 6112, 6160, 6470, 6608, 6784,
  6800, 6992, 7088, 7232, 7248, 42528, 43216, 43264, 43472, 43504, 43600,
  44016, 65296, 66720, 68912, 69734, 69872, 69942, 70096, 70384, 70736,
  70864, 71248, 71360, 71472, 71904, 72016, 72784, 73040, 73120, 92768,
  93008, 120782, 120792, 120802, 120812, 120822, 123200, 123632, 125264, 130032,
];

function digit(code: number | undefined): number | undefined {
  if (code === undefined) return undefined;
  if (code >= 48 && code <= 57) return code - 48;
  for (const zero of decimalZeroes) if (code >= zero && code < zero + 10) return code - zero;
  return undefined;
}

function whitespace(code: number): boolean {
  return code >= 9 && code <= 13 || code === 32 || code === 133 || code === 160
    || code === 5760 || code >= 8192 && code <= 8202 || code === 8232
    || code === 8233 || code === 8239 || code === 8287 || code === 12288;
}

/** Canonicalize Python decimal integer text without rounding through Number. */
export function tokenInteger(input: string): string | undefined {
  let start = 0, end = input.length;
  while (start < end && whitespace(input.charCodeAt(start))) start++;
  while (end > start && whitespace(input.charCodeAt(end - 1))) end--;
  let normalized = "", previousDigit = false, digits = 0;
  if (input[start] === "+" || input[start] === "-") normalized = input[start++]!;
  for (let index = start; index < end;) {
    const code = input.codePointAt(index)!;
    const value = digit(code);
    if (value !== undefined) { normalized += String(value); digits++; previousDigit = true; }
    else if (code === 95 && previousDigit && digit(input.codePointAt(index + 1)) !== undefined) previousDigit = false;
    else return undefined;
    index += code > 65535 ? 2 : 1;
  }
  return digits ? BigInt(normalized).toString() : undefined;
}

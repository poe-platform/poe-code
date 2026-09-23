const maximumMilliseconds = BigInt(Number.MAX_SAFE_INTEGER);

export type DurationResult =
  | { readonly kind: "value"; readonly milliseconds: number }
  | { readonly kind: "invalid" }
  | { readonly kind: "overflow" };

function multiplier(code: number): number | undefined {
  if (code === 115) return 1000;
  if (code === 109) return 60000;
  if (code === 104) return 3600000;
  if (code === 100) return 86400000;
  return undefined;
}

export function parseDuration(token: string): DurationResult {
  const end = token.length;
  let index = 0;
  while (index < end && (token[index] === " " || (token.charCodeAt(index) >= 9 && token.charCodeAt(index) <= 13))) index++;
  const negative = token[index] === "-";
  if (negative || token[index] === "+") index++;
  const hexadecimal = token[index] === "0" && (token[index + 1] === "x" || token[index + 1] === "X");
  if (hexadecimal) index += 2;
  const radix = hexadecimal ? 16 : 10;
  let digits = "";
  let fractionalDigits = 0;
  let sawPoint = false;
  while (index < end) {
    const character = token[index]!;
    if (character === "." && !sawPoint) {
      sawPoint = true;
      index++;
      continue;
    }
    const code = character.toLowerCase().charCodeAt(0);
    const digit = code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 102 ? code - 87 : radix;
    if (digit >= radix) break;
    digits += character;
    if (sawPoint) fractionalDigits++;
    index++;
  }
  if (digits.length === 0) return { kind: "invalid" };
  let exponent = 0;
  const exponentMarker = hexadecimal ? "p" : "e";
  // Saturation bounds arithmetic to the operand size, including fractional scale.
  const exponentLimit = token.length * 4 + 100;
  if (token[index]?.toLowerCase() === exponentMarker) {
    index++;
    const exponentNegative = token[index] === "-";
    if (exponentNegative || token[index] === "+") index++;
    const start = index;
    while (index < end && token.charCodeAt(index) >= 48 && token.charCodeAt(index) <= 57) {
      exponent = Math.min(exponentLimit, exponent * 10 + token.charCodeAt(index) - 48);
      index++;
    }
    if (index === start) return { kind: "invalid" };
    if (exponentNegative) exponent = -exponent;
  }
  const suffixMultiplier = multiplier(token.charCodeAt(index));
  if (index !== end && (suffixMultiplier === undefined || index + 1 !== end)) return { kind: "invalid" };
  const significand = BigInt(hexadecimal ? "0x" + digits : digits);
  if (significand === 0n) return { kind: "value", milliseconds: 0 };
  if (negative) return { kind: "invalid" };
  const scale = exponent - fractionalDigits * (hexadecimal ? 4 : 1);
  const base = hexadecimal ? 2n : 10n;
  let numerator = significand * BigInt(suffixMultiplier ?? 1000);
  let denominator = 1n;
  if (scale >= 0) numerator *= base ** BigInt(scale);
  else denominator = base ** BigInt(-scale);
  const milliseconds = (numerator + denominator - 1n) / denominator;
  if (milliseconds > maximumMilliseconds) return { kind: "overflow" };
  return { kind: "value", milliseconds: Number(milliseconds) };
}

const maximumMilliseconds = Number.MAX_SAFE_INTEGER;

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
  const length = token.length;
  const suffixCode = token.charCodeAt(length - 1);
  const suffixMultiplier = multiplier(suffixCode);
  const millisecondsPerUnit = suffixMultiplier ?? 1000;
  const quotient = Math.floor(maximumMilliseconds / millisecondsPerUnit);
  let index = length - 1 - (suffixMultiplier === undefined ? 0 : 1);
  let invalid = false;
  let sawPoint = false;
  let trailingDigits = 0;
  let integerDigits = 0;
  let integer = 0;
  let place = 1;
  let placeOverflow = false;
  let integerOverflow = false;
  let fractionCarry = 0;
  let fractionSticky = false;

  for (; index >= 0; index--) {
    const code = token.charCodeAt(index);
    if (code >= 48 && code <= 57) {
      const digit = code - 48;
      if (!sawPoint) {
        trailingDigits++;
        const temporary = digit * millisecondsPerUnit + fractionCarry;
        fractionCarry = Math.floor(temporary / 10);
        fractionSticky ||= temporary % 10 !== 0;
      } else integerDigits++;
      if (digit !== 0) {
        if (placeOverflow || digit > Math.floor((quotient - integer) / place)) integerOverflow = true;
        else integer += digit * place;
      }
      if (!placeOverflow) {
        if (place > Math.floor(quotient / 10)) placeOverflow = true;
        else place *= 10;
      }
      continue;
    }
    if (code === 46) {
      if (sawPoint) invalid = true;
      else {
        sawPoint = true;
        integer = 0;
        place = 1;
        placeOverflow = false;
        integerOverflow = false;
      }
      continue;
    }
    invalid = true;
  }

  if (sawPoint ? trailingDigits + integerDigits === 0 : trailingDigits === 0) invalid = true;
  if (invalid) return { kind: "invalid" };
  if (integerOverflow) return { kind: "overflow" };
  const fraction = sawPoint ? fractionCarry + (fractionSticky ? 1 : 0) : 0;
  const product = integer * millisecondsPerUnit;
  if (fraction > maximumMilliseconds - product) return { kind: "overflow" };
  return { kind: "value", milliseconds: product + fraction };
}

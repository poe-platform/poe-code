// GOffice go_strtod consumes decimal prefixes and clears errno before libc
// conversion. The qualified Linux AArch64 profile detects tininess before
// rounding: inexact tiny inputs raise ERANGE, including those rounding to a
// normal result. Exact subnormal inputs do not. Compare decimal expansions
// without allocating an integer proportional to the supplied exponent.
const minimumNormalDigits = (5n ** 1022n).toString();
const subnormalDecimalScale = 5n ** 1074n;

export function datasourceNumber(text: string, tick: () => void): number | undefined {
  let at = 0;
  while (at < text.length && " \t\r\n\v\f".includes(text[at]!)) { tick(); at++; }
  const start = at;
  if (text[at] === "+" || text[at] === "-") at++;
  const special = text.slice(at, at + 3).toLowerCase();
  if (special === "inf") return text[start] === "-" ? -Infinity : Infinity;
  if (special === "nan") return NaN;
  const digit = (character: string | undefined) => character !== undefined && character >= "0" && character <= "9";
  let digits = "", fractionDigits = 0;
  while (digit(text[at])) { tick(); digits += text[at++]; }
  if (text[at] === ".") {
    at++;
    while (digit(text[at])) { tick(); digits += text[at++]; fractionDigits++; }
  }
  if (!digits.length) return undefined;
  // GOffice rejects hex syntax while consuming its decimal zero prefix.
  const value = Number.parseFloat(text.slice(start));
  if (!Number.isFinite(value)) return undefined;
  let first = 0;
  while (digits[first] === "0") { tick(); first++; }
  if (first === digits.length) return value;
  if (value === 0) return undefined;
  if (Math.abs(value) > 2 ** -1022) return value;

  let exponent = 0;
  if (text[at] === "e" || text[at] === "E") {
    const exponentStart = ++at;
    if (text[at] === "+" || text[at] === "-") at++;
    const exponentDigits = at;
    while (digit(text[at])) { tick(); at++; }
    if (at !== exponentDigits) exponent = Number(text.slice(exponentStart, at));
  }
  let end = digits.length;
  while (digits[end - 1] === "0") { tick(); end--; }
  const coefficient = digits.slice(first, end);
  const power = exponent - fractionDigits + digits.length - end;
  const order = coefficient.length + power;
  const minimumOrder = minimumNormalDigits.length - 1022;
  let tiny = order < minimumOrder;
  if (order === minimumOrder) {
    for (let index = 0; index < Math.max(coefficient.length, minimumNormalDigits.length); index++) {
      tick();
      const supplied = coefficient[index] ?? "0", minimum = minimumNormalDigits[index] ?? "0";
      if (supplied !== minimum) { tiny = supplied < minimum; break; }
    }
  }
  if (!tiny) return value;
  // Each subnormal is an integer multiple of2^-1074. Its exact base10
  // expansion has a bounded coefficient, even when input text is very long.
  tick();
  const exact = (BigInt(Math.abs(value) / Number.MIN_VALUE) * subnormalDecimalScale).toString();
  let exactEnd = exact.length;
  while (exact[exactEnd - 1] === "0") { tick(); exactEnd--; }
  tick();
  return power === -1074 + exact.length - exactEnd && coefficient === exact.slice(0, exactEnd) ? value : undefined;
}

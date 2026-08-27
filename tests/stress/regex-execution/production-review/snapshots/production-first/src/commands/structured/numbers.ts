import type { Budget } from "./limits.js";

export class Decimal {
  constructor(readonly digits: string, readonly exponent: number, readonly negative: boolean, readonly text: string, readonly double: number) {
    Object.freeze(this);
  }
}
export type Numeric = number | Decimal;
export function isNumber(value: unknown): value is Numeric { return typeof value === "number" || value instanceof Decimal; }
export function numberValue(value: Numeric): number { return typeof value === "number" ? value : value.double; }
export function numericToken(token: string, budget: Budget): Numeric | undefined {
  budget.step(Math.ceil(token.length / 32));
  const end = token.indexOf("\0");
  const text = end < 0 ? token : token.slice(0, end);
  if (/^[+-]?s?nan[0-9]*$/iu.test(text)) return new Decimal("0", NaN, false, "null", NaN);
  if (/^[+-]?inf(?:inity)?$/iu.test(text)) {
    const negative = text[0] === "-";
    const value = negative ? -Infinity : Infinity;
    return new Decimal("1", Infinity, negative, numberText(value), value);
  }
  if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/u.test(text)) return undefined;
  return decimalNumber(text[0] === "+" ? text.slice(1) : text, budget);
}

function increment(digits: string): string {
  let position = digits.length - 1;
  while (position >= 0 && digits[position] === "9") position--;
  return position < 0 ? `1${"0".repeat(digits.length)}` : `${digits.slice(0, position)}${Number(digits[position]) + 1}${"0".repeat(digits.length - position - 1)}`;
}
function decimalDouble(digits: string, exponent: number, negative: boolean): number {
  let rounded = digits;
  if (digits.length > 17) {
    rounded = digits.slice(0, 17);
    const next = digits[17]!;
    if (next > "5" || (next === "5" && (/[1-9]/u.test(digits.slice(18)) || Number(rounded[16]) % 2 !== 0))) rounded = increment(rounded);
    exponent += digits.length - 17;
  }
  return Number(`${negative ? "-" : ""}${rounded}e${exponent}`);
}
function decimalText(digits: string, exponent: number, negative: boolean): string {
  const sign = negative ? "-" : "";
  const adjusted = exponent + digits.length - 1;
  if (exponent > 0 || adjusted < -6) return `${sign}${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}E${adjusted >= 0 ? "+" : ""}${adjusted}`;
  const point = digits.length + exponent;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  return `${sign}${digits.slice(0, point)}${point < digits.length ? `.${digits.slice(point)}` : ""}`;
}
export function decimalNumber(token: string, budget: Budget): Numeric {
  budget.text(token);
  budget.step(Math.ceil(token.length / 32));
  const negative = token[0] === "-";
  const unsigned = negative ? token.slice(1) : token;
  const marker = unsigned.search(/[eE]/u);
  const coefficient = marker < 0 ? unsigned : unsigned.slice(0, marker);
  const point = coefficient.indexOf(".");
  let exponent = (marker < 0 ? 0 : Number(unsigned.slice(marker + 1))) - (point < 0 ? 0 : coefficient.length - point - 1);
  let digits = coefficient.replace(".", "").replace(/^0+/u, "") || "0";
  const minimumExponent = -1147483646;
  const maximumExponent = 999999999;
  if (digits === "0") exponent = Math.max(minimumExponent, Math.min(maximumExponent, exponent));
  else if (exponent + digits.length - 1 > maximumExponent) {
    const infinity = negative ? -Infinity : Infinity;
    return new Decimal("1", Infinity, negative, numberText(infinity), infinity);
  }
  else if (exponent < minimumExponent) {
    const retained = digits.length - (minimumExponent - exponent);
    const roundUp = retained >= 0 && digits[retained]! >= "5";
    digits = retained > 0 ? digits.slice(0, retained) : "0";
    if (roundUp) digits = increment(digits);
    exponent = minimumExponent;
  }
  const text = decimalText(digits, exponent, negative);
  budget.text(text);
  return new Decimal(digits, exponent, negative, text, decimalDouble(digits, exponent, negative));
}
export function compareNumbers(left: Numeric, right: Numeric, budget: Budget): number {
  if (Number.isNaN(numberValue(left))) return -1;
  if (Number.isNaN(numberValue(right))) return 1;
  if (!(left instanceof Decimal) || !(right instanceof Decimal)) {
    const first = numberValue(left);
    const second = numberValue(right);
    return first < second ? -1 : first === second ? 0 : 1;
  }
  if (left.digits === "0" && right.digits === "0") return 0;
  const sign = left.negative ? -1 : 1;
  if (left.negative !== right.negative) return sign;
  if (left.digits === "0") return -sign;
  if (right.digits === "0") return sign;
  if (left.exponent === Infinity || right.exponent === Infinity) return left.exponent === right.exponent ? 0 : left.exponent === Infinity ? sign : -sign;
  const magnitude = left.exponent + left.digits.length - right.exponent - right.digits.length;
  if (magnitude) return Math.sign(magnitude) * sign;
  const length = Math.max(left.digits.length, right.digits.length);
  budget.step(Math.ceil(length / 32));
  for (let index = 0; index < length; index++) {
    if (index % 1024 === 0) budget.step();
    const first = left.digits[index] ?? "0";
    const second = right.digits[index] ?? "0";
    if (first !== second) return (first < second ? -1 : 1) * sign;
  }
  return 0;
}
export function numberText(value: Numeric): string {
  if (value instanceof Decimal) return value.text;
  if (Number.isNaN(value)) return "null";
  const bounded = Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, value));
  const sign = bounded < 0 || Object.is(bounded, -0) ? "-" : "";
  const [mantissa, power] = Math.abs(bounded).toExponential().split("e");
  const digits = mantissa!.replace(".", "");
  const exponent = Number(power);
  const point = exponent + 1;
  if (point <= -4 || point > digits.length + 15) return `${sign}${mantissa}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  return `${sign}${point >= digits.length ? digits.padEnd(point, "0") : `${digits.slice(0, point)}.${digits.slice(point)}`}`;
}

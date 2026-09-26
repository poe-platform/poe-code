const magnitudeLimit = 1n << 63n;
const nanoseconds: Readonly<Record<string, bigint>> = Object.freeze({
  ns: 1n, us: 1000n, "µs": 1000n, "μs": 1000n, ms: 1000000n,
  s: 1000000000n, m: 60000000000n, h: 3600000000000n,
});

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function roundedHundredths(value: number): bigint {
  if (value === 0) return 0n;
  const buffer = new DataView(new ArrayBuffer(8));
  buffer.setFloat64(0, value);
  const bits = buffer.getBigUint64(0);
  const exponent = Number(bits >> 52n);
  const significand = (bits & ((1n << 52n) - 1n)) + (exponent === 0 ? 0n : 1n << 52n);
  const shift = (exponent === 0 ? 1 : exponent) - 1023 - 52;
  const numerator = significand * 100n;
  if (shift >= 0) return numerator << BigInt(shift);
  const denominator = 1n << BigInt(-shift);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n > denominator || remainder * 2n === denominator && quotient % 2n !== 0n ? 1n : 0n);
}

export function isOpDuration(value: string, extendedUnits = true): boolean {
  const negative = value[0] === "-";
  let cursor = value[0] === "+" || negative ? 1 : 0;
  if (value.slice(cursor) === "0") return true;
  if (cursor === value.length) return false;
  let total = 0n;
  while (cursor < value.length) {
    const start = cursor;
    while (isDigit(value[cursor])) cursor++;
    const integerEnd = cursor;
    if (value[cursor] === ".") cursor++;
    const fractionStart = cursor;
    while (isDigit(value[cursor])) cursor++;
    const numberEnd = cursor;
    if (integerEnd === start && fractionStart === numberEnd) return false;
    while (cursor < value.length && !isDigit(value[cursor]) && value[cursor] !== ".") cursor++;
    const unitName = value.slice(numberEnd, cursor);
    let component: bigint;
    if (extendedUnits && (unitName === "d" || unitName === "w")) {
      const hours = Number(value.slice(start, numberEnd)) * (unitName === "d" ? 24 : 168);
      if (!Number.isFinite(hours) || hours > Number(magnitudeLimit) / Number(nanoseconds.h!) + 1) return false;
      component = roundedHundredths(hours) * 36000000000n;
    } else {
      if (!Object.hasOwn(nanoseconds, unitName)) return false;
      const unit = nanoseconds[unitName]!;
      let integer = 0n;
      for (let index = start; index < integerEnd; index++) {
        integer = integer * 10n + BigInt(value[index]!);
        if (integer > magnitudeLimit) return false;
      }
      component = integer * unit;
      if (component > magnitudeLimit) return false;
      let fraction = 0n;
      let scale = 1;
      for (let index = fractionStart; index < numberEnd; index++) {
        const next = fraction * 10n + BigInt(value[index]!);
        if (fraction > (magnitudeLimit - 1n) / 10n || next > magnitudeLimit) break;
        fraction = next;
        scale *= 10;
      }
      component += BigInt(Math.trunc(Number(fraction) * (Number(unit) / scale)));
    }
    if (component > magnitudeLimit) return false;
    total = BigInt.asUintN(64, total + component);
    if (total > magnitudeLimit) return false;
  }
  return total <= magnitudeLimit - (negative ? 0n : 1n);
}

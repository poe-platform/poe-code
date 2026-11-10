// Keep a low component through range reduction and the series. A one-bit error
// in log/exp can move gate output across a PCM32 or float32 rounding boundary.
type Pair = readonly [number, number];

function add([a, aLow]: Pair, [b, bLow]: Pair): Pair {
  const sum = a + b;
  const v = sum - a;
  const error = (a - (sum - v)) + (b - v) + aLow + bLow;
  return [sum + error, error - ((sum + error) - sum)];
}

function multiply([a, aLow]: Pair, [b, bLow]: Pair): Pair {
  const product = a * b;
  const splitA = 134217729 * a;
  const splitB = 134217729 * b;
  const aHigh = splitA - (splitA - a);
  const bHigh = splitB - (splitB - b);
  const aTail = a - aHigh;
  const bTail = b - bHigh;
  const error = ((aHigh * bHigh - product) + aHigh * bTail + aTail * bHigh)
    + aTail * bTail + a * bLow + aLow * b;
  return [product + error, error - ((product + error) - product)];
}

function divide(value: Pair, divisor: number): Pair {
  const quotient = value[0] / divisor;
  const remainder = add(value, multiply([quotient, 0], [-divisor, 0]));
  return add([quotient, 0], [(remainder[0] + remainder[1]) / divisor, 0]);
}

const ln2: Pair = [0.6931471805599453, 2.3190468138462996e-17];

export function gateLog(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return Math.log(value);
  const exponent = Math.min(1023, Math.round(Math.log2(value)));
  const mantissa = value / 2 ** exponent;
  const denominator = add([mantissa, 0], [1, 0]);
  let z = divide([mantissa - 1, 0], denominator[0]);
  z = add(z, divide(multiply(z, [-denominator[1], 0]), denominator[0]));
  const z2 = multiply(z, z);
  let term = z;
  let sum = z;
  // log(m) = 2 * (z + z^3/3 + ...), z = (m - 1)/(m + 1).
  for (let i = 3; i <= 39; i += 2) {
    term = multiply(term, z2);
    sum = add(sum, divide(term, i));
  }
  const result = add(multiply(sum, [2, 0]), multiply([exponent, 0], ln2));
  return result[0] + result[1];
}

export function gateExp(value: number): number {
  const exponent = Math.round(value / Math.LN2);
  if (exponent < -1022 || exponent > 1023 || !Number.isFinite(value)) return Math.exp(value);
  const reduced = add([value, 0], multiply([-exponent, 0], ln2));
  let term: Pair = [1, 0];
  let sum: Pair = [1, 0];
  // The reduced exponent is at most ln(2)/2, so this fixed series is bounded.
  for (let i = 1; i <= 18; i++) {
    term = divide(multiply(term, reduced), i);
    sum = add(sum, term);
  }
  return (sum[0] + sum[1]) * 2 ** exponent;
}

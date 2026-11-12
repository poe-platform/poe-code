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
  return expSeries(reduced, exponent);
}

// acrusher's validated bit depth is in [1, 64]. Preserve the low ln(2) part
// before rounding exp2, including when runtime commands change the depth.
export function audioExp2(value: number): number {
  const exponent = Math.round(value);
  return expSeries(multiply([value - exponent, 0], ln2), exponent);
}

// Filter coefficients need the low component that Math.tan can round away.
export function audioTan(value: number): number {
  const periods = Math.round(value / Math.PI);
  const x = add([value, 0], multiply([-periods, 0], [Math.PI, 1.2246467991473532e-16]));
  const negativeSquare = multiply(multiply(x, x), [-1, 0]);
  let sine = x;
  let cosine: Pair = [1, 0];
  let sineTerm = sine;
  let cosineTerm = cosine;
  // Reduction bounds x to [-pi/2, pi/2].
  for (let i = 1; i <= 24; i++) {
    sineTerm = divide(multiply(sineTerm, negativeSquare), 2 * i * (2 * i + 1));
    cosineTerm = divide(multiply(cosineTerm, negativeSquare), (2 * i - 1) * 2 * i);
    sine = add(sine, sineTerm);
    cosine = add(cosine, cosineTerm);
  }
  const quotient = divide(sine, cosine[0]);
  const result = add(quotient, divide(multiply(quotient, [-cosine[1], 0]), cosine[0]));
  return result[0] + result[1];
}

// Fade cosine arguments are bounded to [0, pi/2]. Keep the low component
// until the final rounding; Math.cos can differ by one bit from native FFmpeg.
export function fadeCos(value: number): number {
  const negativeSquare = multiply([value, 0], [-value, 0]);
  let term: Pair = [1, 0];
  let sum = term;
  for (let i = 1; i <= 18; i++) {
    term = divide(multiply(term, negativeSquare), (2 * i - 1) * 2 * i);
    sum = add(sum, term);
  }
  return sum[0] + sum[1];
}

// ihsin needs native acos rounding before multiplication and PCM conversion.
// Reduce asin's argument to [-1/2, 1/2], retaining the sqrt residual and low pi.
export function fadeAcos(value: number): number {
  if (Math.abs(value) >= 1) return Math.acos(value);
  const reduced = Math.abs(value) > 0.5;
  let x: Pair = [value, 0];
  if (reduced) {
    const square = (1 - Math.abs(value)) / 2;
    const root = Math.sqrt(square);
    const residual = add([square, 0], multiply([root, 0], [-root, 0]));
    x = add([root, 0], divide(residual, 2 * root));
  }
  const square = multiply(x, x);
  let term = x;
  let sum = x;
  for (let i = 1; i <= 48; i++) {
    term = divide(multiply(multiply(term, square), [(2 * i - 1) ** 2, 0]), 2 * i * (2 * i + 1));
    sum = add(sum, term);
  }
  const result = reduced
    ? value < 0
      ? add([Math.PI, 1.2246467991473532e-16], multiply(sum, [-2, 0]))
      : multiply(sum, [2, 0])
    : add([Math.PI / 2, 6.123233995736766e-17], multiply(sum, [-1, 0]));
  return result[0] + result[1];
}

function expSeries(reduced: Pair, exponent: number): number {
  let term: Pair = [1, 0];
  let sum: Pair = [1, 0];
  // The reduced exponent is at most ln(2)/2, so this fixed series is bounded.
  for (let i = 1; i <= 18; i++) {
    term = divide(multiply(term, reduced), i);
    sum = add(sum, term);
  }
  return (sum[0] + sum[1]) * 2 ** exponent;
}

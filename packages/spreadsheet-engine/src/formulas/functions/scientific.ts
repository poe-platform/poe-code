import { numericResult, error } from "../values.js";
import { numberArg } from "./common.js";
import { sinPi } from "./math.js";
import { capturedExp, fusedMultiplyAdd } from "./numeric-arithmetic.js";
import type { FunctionHost, FunctionImplementation } from "./types.js";

/** Bernoulli correction to Stirling; evaluated only after recurrence to x >= 16. */
function correction(x: number): number {
  const inverse = 1 / x, square = inverse * inverse;
  return inverse * (1 / 12 + square * (-1 / 360 + square * (1 / 1260 + square * (-1 / 1680 + square * (1 / 1188 + square * (-691 / 360360))))));
}
type GammaPair = readonly [number, number];
function gammaAdd(a: GammaPair, b: GammaPair): GammaPair {
  const high = a[0] + b[0], split = high - a[0];
  const low = (a[0] - (high - split)) + (b[0] - split) + a[1] + b[1];
  const result = high + low;
  return [result, low - (result - high)];
}
function gammaMultiply(a: GammaPair, b: GammaPair): GammaPair {
  const high = a[0] * b[0];
  const low = fusedMultiplyAdd(a[0], b[0], -high) + a[0] * b[1] + a[1] * b[0];
  return gammaAdd([high, 0], [low, 0]);
}
function gammaDivide(a: GammaPair, b: GammaPair): GammaPair {
  const high = a[0] / b[0], product = gammaMultiply([high, 0], b);
  const remainder = gammaAdd(a, [-product[0], -product[1]]);
  return gammaAdd([high, 0], [(remainder[0] + remainder[1]) / b[0], 0]);
}
const gammaLogTwo: GammaPair = [.6931471805599453, 2.3190468138462996e-17];
/** Atanh reduction converges geometrically with |r| <= 1/3. */
function gammaLog(x: GammaPair, host: FunctionHost): GammaPair {
  const exponent = Math.floor(Math.log2(x[0])), power = 2 ** exponent;
  const mantissa: GammaPair = [x[0] / power, x[1] / power];
  const ratio = gammaDivide(gammaAdd(mantissa, [-1, 0]), gammaAdd(mantissa, [1, 0]));
  const square = gammaMultiply(ratio, ratio);
  let term = ratio, sum = ratio;
  for (let i = 3; i < 145; i += 2) {
    host.tick(); term = gammaMultiply(term, square);
    sum = gammaAdd(sum, gammaDivide(term, [i, 0]));
    if (Math.abs(term[0]) < 1e-34) break;
  }
  return gammaAdd(gammaMultiply(sum, [2, 0]), gammaMultiply(gammaLogTwo, [exponent, 0]));
}
/** Exponent scaling is delayed until the final binary64 rounding. */
function gammaExp(x: GammaPair, host: FunctionHost): { mantissa: GammaPair; exponent: number } {
  const exponent = Math.round(x[0] / Math.LN2), multiple = gammaMultiply(gammaLogTwo, [exponent, 0]);
  const reduced = gammaAdd(x, [-multiple[0], -multiple[1]]);
  let term: GammaPair = [1, 0], sum = term;
  for (let i = 1; i < 45; i++) {
    host.tick(); term = gammaDivide(gammaMultiply(term, reduced), [i, 0]);
    sum = gammaAdd(sum, term);
    if (Math.abs(term[0]) < 1e-34) break;
  }
  return { mantissa: sum, exponent };
}
/** Two-component Stirling evaluation avoids subtracting rounded logarithms.
 * Recurrence to 32 bounds the omitted Bernoulli term below 1e-33. */
function recurrentGamma(x: number, host: FunctionHost): number {
  if (x > 172) return Infinity;
  let shifted: GammaPair = [x, 0], recurrence: GammaPair = [1, 0];
  let recurrenceExponent = 0;
  // Separate a very small first factor so recurrence products cannot underflow.
  const small = x > 0 && x < .5;
  if (small) shifted = gammaAdd(shifted, [1, 0]);
  while (shifted[0] < 32) {
    host.tick(); recurrence = gammaMultiply(recurrence, shifted);
    if (Math.abs(recurrence[0]) > 2 ** 500) {
      recurrence = [recurrence[0] * 2 ** -256, recurrence[1] * 2 ** -256];
      recurrenceExponent += 256;
    }
    shifted = gammaAdd(shifted, [1, 0]);
  }
  const inverse = gammaDivide([1, 0], shifted), square = gammaMultiply(inverse, inverse);
  const bernoulli: readonly (readonly [number, number])[] = [
    [1, 12], [-1, 360], [1, 1260], [-1, 1680], [1, 1188], [-691, 360360],
    [1, 156], [-3617, 122400], [43867, 244188], [-174611, 125400],
    [77683, 5796], [-236364091, 1506960]
  ];
  let term = inverse, adjustment: GammaPair = [0, 0];
  for (const [numerator, denominator] of bernoulli) {
    host.tick(); adjustment = gammaAdd(adjustment,
      gammaMultiply(term, gammaDivide([numerator, 0], [denominator, 0])));
    term = gammaMultiply(term, square);
  }
  let logarithm = gammaMultiply(gammaAdd(shifted, [-.5, 0]), gammaLog(shifted, host));
  logarithm = gammaAdd(logarithm, [-shifted[0], -shifted[1]]);
  logarithm = gammaAdd(logarithm, [.9189385332046728, -3.8782941580672414e-17]);
  logarithm = gammaAdd(logarithm, adjustment);
  const result = gammaExp(logarithm, host);
  result.exponent -= recurrenceExponent;
  let mantissa = gammaDivide(result.mantissa, recurrence);
  if (small) {
    // The quotient is rounded only after the tiny input's exact scaling.
    const exponent = Math.floor(Math.log2(x)), power = 2 ** exponent;
    mantissa = gammaDivide(mantissa, [x / power, 0]);
    result.exponent -= exponent;
  }
  const normalization = Math.floor(Math.log2(Math.abs(mantissa[0]))), normalizationPower = 2 ** normalization;
  mantissa = [mantissa[0] / normalizationPower, mantissa[1] / normalizationPower];
  result.exponent += normalization;
  // qgammaf rounds its mantissa before scalbn. Perform its single subnormal
  // scaling round, rather than rounding an underflowed half then doubling it.
  const rounded = mantissa[0] + mantissa[1];
  if (result.exponent > 1023) return Math.sign(rounded) * Infinity;
  if (result.exponent < -1075) return Math.sign(rounded) * 0;
  if (result.exponent === -1075) return rounded / 2 * Number.MIN_VALUE;
  return rounded * 2 ** result.exponent;
}
export function logGamma(x: number, host: FunctionHost): number {
  if (x <= 0) {
    const sine = sinPi(x);
    return sine === 0 ? NaN : Math.log(Math.PI / Math.abs(sine)) - logGamma(1 - x, host);
  }
  let shifted = x, recurrence = 0;
  while (shifted < 16) { host.tick(); recurrence += Math.log(shifted); shifted++; }
  return (shifted - .5) * Math.log(shifted) - shifted + .5 * Math.log(2 * Math.PI) + correction(shifted) - recurrence;
}
/** Recurrence retains exact factorials and the half-integer anchor where applicable. */
export function gamma(x: number, host: FunctionHost): number {
  if (x <= 0) {
    const sine = sinPi(x);
    // qgammaf admits x-1 as binary64 before qfactf's two-component work.
    if (sine !== 0 && x >= -180) return recurrentGamma(x < -1.5 ? (x - 1) + 1 : x, host);
    return sine === 0 ? NaN : Math.sign(sine) * Math.exp(Math.log(Math.PI / Math.abs(sine)) - logGamma(1 - x, host));
  }
  if (x === Math.floor(x) && x <= 171) {
    let result = 1n; for (let i = 2; i < x; i++) { host.tick(); result *= BigInt(i); } return Number(result);
  }
  return recurrentGamma(x, host);
}
function logBeta(a: number, b: number, host: FunctionHost): number {
  if (a <= 0 || b <= 0) return logGamma(a, host) + logGamma(b, host) - logGamma(a + b, host);
  let shift = 0;
  while (a < 16) { host.tick(); shift += Math.log1p(b / a); a++; }
  while (b < 16) { host.tick(); shift += Math.log1p(a / b); b++; }
  const maximum = Math.max(a, b), minimum = Math.min(a, b), ratio = minimum / maximum;
  const totalLog = Math.log(maximum) + Math.log1p(ratio), logSmall = Math.log(ratio) - Math.log1p(ratio), logLarge = -Math.log1p(ratio);
  return (minimum - .5) * logSmall + (maximum - .5) * logLarge - .5 * totalLog + .5 * Math.log(2 * Math.PI)
    + correction(a) + correction(b) - correction(a + b) + shift;
}
function gammaSign(x: number): number { return x > 0 ? 1 : Math.sign(sinPi(x)); }
/** qfactf's native signed-int exponent bound applies even when beta is finite. */
function gammaExponentOverflows(x: number): boolean {
  const positive = x <= 0 ? 1 - x : x;
  return positive - 1 >= 1073741823 || positive * Math.log2(positive / Math.E) > 1073741823;
}
export const scientificFunctions: Readonly<Record<string, FunctionImplementation>> = {
  GAMMA: (args, host) => numericResult(gamma(numberArg(args, 0, host), host)),
  GAMMALN: (args, host) => {
    const x = numberArg(args, 0, host);
    return x === 0 || x < 0 && (x === Math.floor(x) || Math.floor(-x) % 2 === 0) ? error("#NUM!") : numericResult(logGamma(x, host));
  },
  ...Object.fromEntries(["BETA", "BETALN"].map(name => [name, ((args, host) => {
    const a = numberArg(args, 0, host), b = numberArg(args, 1, host), sign = gammaSign(a) * gammaSign(b) * gammaSign(a + b);
    if (sign === 0) return error("#NUM!");
    const maximum = Math.max(a, b), minimum = Math.min(a, b);
    if (name === "BETA" && !(maximum > 1 && Math.abs(minimum) < 1)
      && [a, b, a + b].some(gammaExponentOverflows)) return error("#NUM!");
    const logarithm = logBeta(a, b, host);
    return numericResult(name === "BETA" ? sign * Math.exp(logarithm) : logarithm);
  }) satisfies FunctionImplementation])),
  DIGAMMA: (args, host) => {
    let x = numberArg(args, 0, host), result = 0;
    if (x <= 0) { const sine = sinPi(x); if (sine === 0) return error("#NUM!"); result = -Math.PI * Math.cos(Math.PI * (x % 2)) / sine; x = 1 - x; }
    while (x < 16) { host.tick(); result -= 1 / x; x++; }
    const inverse = 1 / x, square = inverse * inverse;
    return numericResult(result + Math.log(x) - inverse / 2 - square * (1 / 12 - square * (1 / 120 - square * (1 / 252 - square * (1 / 240 - square * (1 / 132 - square * (691 / 32760)))))));
  },
  POCHHAMMER: (args, host) => {
    const x = numberArg(args, 0, host), n = numberArg(args, 1, host);
    if (x <= 0 && x === Math.floor(x) && n !== Math.floor(n)) return numericResult(0);
    if (n === Math.floor(n) && Math.abs(n) < 10000) {
      let result = 1;
      for (let i = 0; i < Math.abs(n); i++) { host.tick(); result = n >= 0 ? result * (x + i) : result / (x - i - 1); }
      return numericResult(result);
    }
    const logarithm = x >= 16 && x + n >= 16
      ? n * Math.log(x) + (x + n - .5) * Math.log1p(n / x) - n + correction(x + n) - correction(x)
      : logGamma(x + n, host) - logGamma(x, host);
    return numericResult(gammaSign(x + n) * gammaSign(x) * Math.exp(logarithm));
  },
  LAMBERTW: (args, host) => {
    const x = numberArg(args, 0, host), branch = numberArg(args, 1, host);
    if (branch !== 0 && branch !== -1 || x < -1 / Math.E || branch === -1 && x >= 0) return error("#NUM!");
    if (x === 0) return numericResult(0);
    if (x === -1 / Math.E) return numericResult(-1);
    let w = branch === -1 ? x < -.1 ? -1 - 3 * Math.sqrt(x + 1 / Math.E) : Math.log(-x) - Math.log(-Math.log(-x))
      : x < 0 ? 1.5 * (Math.sqrt(x + 1 / Math.E) - Math.sqrt(1 / Math.E))
        : x < 10 ? Math.sqrt(x) / 1.7 : Math.log(x) - Math.log(Math.log(x));
    for (let i = 0; i < 20; i++) {
      host.tick();
      // Preserve the released Halley iteration's intermediate overflow/underflow.
      const exponential = capturedExp(w), residual = fusedMultiplyAdd(w, exponential, -x);
      const first = exponential * (w + 1), second = exponential * (w + 2);
      let delta = -2 * (residual * first) / fusedMultiplyAdd(-residual, second, 2 * first * first);
      let next = w + delta;
      if (branch === 0 && next <= -1 || branch === -1 && next >= -1) {
        delta = (-1 - w) * 15 / 16;
        next = w + delta;
      }
      w = next;
      if (Math.abs(delta) <= 2 * Number.EPSILON * Math.abs(w)) break;
    }
    return numericResult(w);
  }
};

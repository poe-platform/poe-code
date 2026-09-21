import { numericResult, sum } from "../values.js";
import { numberArg } from "./common.js";
import { logGamma } from "./scientific.js";
import { piReduced, sinPi } from "./math.js";
import { capturedExp, fusedMultiplyAdd } from "./numeric-arithmetic.js";
import { capturedHankel, capturedHankelIntegral, capturedIntegerBesselJ, capturedIntegerBesselY, capturedZeroOrderHankel } from "./captured-bessel.js";
import { capturedBesselK } from "./captured-bessel-k.js";
import { capturedBesselI0 } from "./captured-bessel-i.js";
import { besselPhaseDomain, capturedBesselPhase } from "./captured-bessel-phase.js";
import type { FunctionHost, FunctionImplementation } from "./types.js";

const erfCoefficients = {
  pp: [0.12837916709551256, -0.3250421072470015, -0.02848174957559851, -0.005770270296489442, -2.3763016656650163e-05],
  qq: [1.0, 0.39791722395915535, 0.0650222499887673, 0.005081306281875766, 0.00013249473800432164, -3.960228278775368e-06],
  pa: [-0.0023621185607526594, 0.41485611868374833, -0.3722078760357013, 0.31834661990116175, -0.11089469428239668, 0.035478304325618236, -0.002166375594868791],
  qa: [1.0, 0.10642088040084423, 0.540397917702171, 0.07182865441419627, 0.12617121980876164, 0.01363708391202905, 0.011984499846799107],
  ra: [-0.009864944034847148, -0.6938585727071818, -10.558626225323291, -62.375332450326006, -162.39666946257347, -184.60509290671104, -81.2874355063066, -9.814329344169145],
  sa: [1.0, 19.651271667439257, 137.65775414351904, 434.56587747522923, 645.3872717332679, 429.00814002756783, 108.63500554177944, 6.570249770319282, -0.0604244152148581],
  rb: [-0.0098649429247001, -0.799283237680523, -17.757954917754752, -160.63638485582192, -637.5664433683896, -1025.0951316110772, -483.5191916086514],
  sb: [1.0, 30.33806074348246, 325.7925129965739, 1536.729586084437, 3199.8582195085955, 2553.0504064331644, 474.52854120695537, -22.44095244658582],
} as const;

const normalCoefficients = {
  a: [2.2352520354606837, 161.02823106855587, 1067.6894854603709, 18154.98125334356, 0.06568233791820745],
  b: [47.202581904688245, 976.0985517377767, 10260.932208618979, 45507.78933502673],
  c: [0.39894151208813466, 8.883149794388377, 93.50665613217785, 597.2702763948002, 2494.5375852903726, 6848.190450536283, 11602.65143764735, 9842.714838383978, 1.0765576773720192e-08],
  d: [22.266688044328117, 235.387901782625, 1519.3775994075547, 6485.558298266761, 18615.571640885097, 34900.95272114598, 38912.00328609327, 19685.429676859992],
  p: [0.215898534057957, 0.12740116116024736, 0.022235277870649807, 0.0014216191932278934, 2.9112874951168793e-05, 0.023073441764940174],
  q: [1.284260096144911, 0.4682382124808651, 0.06598813786892856, 0.0037823963320275824, 7.297515550839662e-05],
} as const;

const gauss16: readonly (readonly [number, number])[] = [
  [.09501250983763744,.1894506104550685], [.2816035507792589,.18260341504492358],
  [.45801677765722737,.16915651939500254], [.6178762444026438,.14959598881657674],
  [.755404408355003,.12462897125553388], [.8656312023878318,.09515851168249279],
  [.9445750230732326,.062253523938647894], [.9894009349916499,.027152459411754096],
];
const gauss8: readonly (readonly [number, number])[] = [
  [.1834346424956498,.362683783378362], [.525532409916329,.31370664587788727],
  [.7966664774136267,.22238103445337448], [.9602898564975363,.10122853629037626],
];
/** Adaptive Gaussian quadrature, with an invocation-owned work stack. */
function integrate(fn: (x: number) => number, from: number, to: number, host: FunctionHost): number {
  const quadrature = (a: number, b: number, rule: readonly (readonly [number, number])[]): { value: number; roundoff: number } => {
    const middle = a / 2 + b / 2, half = (b - a) / 2, pieces: number[] = [];
    let magnitude = 0;
    for (const [node, weight] of rule) { host.tick(); const left = fn(middle - half * node); host.tick(); const right = fn(middle + half * node); pieces.push(weight * (left + right)); magnitude += weight * (Math.abs(left) + Math.abs(right)); }
    return { value: half * sum(pieces, host.tick), roundoff: 8 * Number.EPSILON * Math.abs(half) * magnitude };
  };
  const estimate = quadrature(from, to, gauss16);
  const stack = [{ from, to, estimate, tolerance: Math.max(Number.MIN_VALUE, Math.abs(estimate.value) * 2e-15), depth: 0 }], pieces: number[] = [];
  while (stack.length) {
    host.tick(); const interval = stack.pop()!, mid = (interval.from + interval.to) / 2;
    const difference = interval.estimate.value - quadrature(interval.from, interval.to, gauss8).value;
    if (!Number.isFinite(interval.estimate.value)) return interval.estimate.value;
    if (Math.abs(difference) <= interval.tolerance + interval.estimate.roundoff || interval.depth >= 24 || mid === interval.from || mid === interval.to) pieces.push(interval.estimate.value);
    else {
      const tolerance = interval.tolerance / 2, depth = interval.depth + 1;
      stack.push({ from: mid, to: interval.to, estimate: quadrature(mid, interval.to, gauss16), tolerance, depth });
      stack.push({ from: interval.from, to: mid, estimate: quadrature(interval.from, mid, gauss16), tolerance, depth });
    }
  }
  return sum(pieces, host.tick);
}
/* SunPro rational approximation coefficients/profile:
 * Copyright (C) 1993 Sun Microsystems, Inc. All rights reserved.
 * Permission to use, copy, modify, and distribute this software is freely
 * granted, provided that this notice is preserved. */
function pairedPolynomial(coefficients: readonly number[], x: number, host: FunctionHost): number {
  const square = x * x, fourth = square * square, powers = [1, square, fourth, fourth * square, fourth * fourth]; let result = 0;
  for (let i = 0; i < coefficients.length; i += 2) {
    host.tick(); const pair = i + 1 < coefficients.length ? fusedMultiplyAdd(x, coefficients[i + 1]!, coefficients[i]!) : coefficients[i]!;
    result = i === 0 ? pair : fusedMultiplyAdd(powers[i / 2]!, pair, result);
  }
  return result;
}
function scalarErrorFunction(x: number, complement: boolean, host: FunctionHost): number {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? x : complement ? x < 0 ? 2 : 0 : Math.sign(x);
  const absolute = Math.abs(x), { pp, qq, pa, qa, ra, sa, rb, sb } = erfCoefficients;
  if (absolute < .84375) {
    if (complement && absolute < 2 ** -56) return 1 - x;
    if (!complement && absolute < 2 ** -28) {
      return absolute < 2 ** -1015 ? .0625 * fusedMultiplyAdd(16 * .1283791670955126, x, 16 * x) : fusedMultiplyAdd(.1283791670955126, x, x);
    }
    const square = x * x, ratio = pairedPolynomial(pp, square, host) / pairedPolynomial(qq, square, host);
    if (!complement) return fusedMultiplyAdd(x, ratio, x);
    return x < .25 ? 1 - fusedMultiplyAdd(x, ratio, x) : .5 - fusedMultiplyAdd(x, ratio, x - .5);
  }
  if (absolute < 1.25) {
    const offset = absolute - 1, ratio = pairedPolynomial(pa, offset, host) / pairedPolynomial(qa, offset, host);
    if (!complement) return x < 0 ? -.8450629115104675 - ratio : .8450629115104675 + ratio;
    return x < 0 ? 1 + (.8450629115104675 + ratio) : (1 - .8450629115104675) - ratio;
  }
  if (!complement && absolute >= 6) return Math.sign(x);
  if (complement && absolute >= 28 || complement && x <= -6) return x < 0 ? 2 : 0;
  const square = 1 / (absolute * absolute), lowRegion = absolute < (complement ? 2.8571414947509766 : 2.8571434020996094);
  const ratio = pairedPolynomial(lowRegion ? ra : rb, square, host) / pairedPolynomial(lowRegion ? sa : sb, square, host);
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, absolute); view.setUint32(4, 0); const high = view.getFloat64(0);
  const tail = capturedExp(fusedMultiplyAdd(-high, high, -.5625)) * capturedExp(fusedMultiplyAdd(high - absolute, high + absolute, ratio)) / absolute;
  return complement ? x < 0 ? 2 - tail : tail : x < 0 ? tail - 1 : 1 - tail;
}
/** Released Cody normal-tail rational evaluation, preserving operation order. */
function normalUpper(x: number, host: FunctionHost): number {
  const { a, b, c, d, p, q } = normalCoefficients;
  let numerator: number, denominator: number, ratio: number;
  if (x <= .67448975) {
    const square = x * x;
    numerator = x > Number.EPSILON / 2 ? a[4] * square : 0;
    denominator = x > Number.EPSILON / 2 ? square : 0;
    if (x > Number.EPSILON / 2) for (let i = 0; i < 3; i++) { host.tick(); numerator = (numerator + a[i]!) * square; denominator = (denominator + b[i]!) * square; }
    return .5 - x * (numerator + a[3]) / (denominator + b[3]);
  }
  if (x <= Math.sqrt(32)) {
    numerator = c[8] * x; denominator = x;
    for (let i = 0; i < 7; i++) { host.tick(); numerator = (numerator + c[i]!) * x; denominator = (denominator + d[i]!) * x; }
    ratio = (numerator + c[7]) / (denominator + d[7]);
  } else {
    if (x >= 37.5193) return 0;
    const square = 1 / (x * x);
    numerator = p[5] * square; denominator = square;
    for (let i = 0; i < 4; i++) { host.tick(); numerator = (numerator + p[i]!) * square; denominator = (denominator + q[i]!) * square; }
    ratio = (.3989422804014327 - square * (numerator + p[4]) / (denominator + q[4])) / x;
  }
  const high = Math.trunc(x * 16) / 16, delta = (x - high) * (x + high);
  return capturedExp(-high * high * .5) * capturedExp(-delta * .5) * ratio;
}
function normalDensity(x: number): number {
  if (x < 4) return .3989422804014327 * capturedExp(-.5 * x * x);
  if (x >= 100) return 0;
  const high = Math.round(x * 65536) / 65536, low = x - high;
  return .3989422804014327 * capturedExp(-.5 * high * high) * capturedExp(-low * fusedMultiplyAdd(.5, low, high));
}
export function normalInterval(lower: number, upper: number, host: FunctionHost): number {
  host.tick();
  if (lower > upper) return -normalInterval(upper, lower, host);
  if (lower === upper) return 0;
  if (lower === 0) return scalarErrorFunction(upper / Math.SQRT2, false, host) / 2;
  if (upper === 0) return scalarErrorFunction(lower / -Math.SQRT2, false, host) / 2;
  if (lower <= 0 && upper >= 0) {
    const small = Math.min(-lower, upper), large = Math.max(-lower, upper);
    return 2 * normalInterval(0, small, host) + normalInterval(small, large, host);
  }
  if (lower < 0) return normalInterval(-upper, -lower, host);
  const first = normalUpper(lower, host), second = normalUpper(upper, host), raw = first - second;
  if (Math.abs(raw) * 32 > Math.abs(first + second)) return raw;
  const width = upper - lower;
  return Math.min(Math.max(raw, width * normalDensity(upper)), width * normalDensity(lower));
}
function series(x: number, order: number, modified: boolean, host: FunctionHost): number {
  if (x === 0) return order === 0 ? 1 : 0;
  const halfInteger = order % 1 === .5 || order === -.5;
  if ((order === Math.floor(order) && order >= 0 || halfInteger && order >= -.5 && x / 2 > 0) && order <= 171) {
    let high = 1, low = 0;
    const multiplyDivide = (factor: number, divisor: number): void => {
      const product = high * factor, residual = fusedMultiplyAdd(high, factor, -product) + low * factor;
      const quotient = product / divisor, correction = (fusedMultiplyAdd(-quotient, divisor, product) + residual) / divisor;
      high = quotient + correction; low = quotient - high + correction;
    };
    if (halfInteger) {
      const root = Math.sqrt(x / 2), rootLow = fusedMultiplyAdd(-root, root, x / 2) / (2 * root);
      const denominator = root * 1.772453850905516;
      const denominatorLow = fusedMultiplyAdd(root, 1.772453850905516, -denominator) + rootLow * 1.772453850905516 - root * 7.666586499825799e-17;
      const quotient = 1 / denominator, correction = (fusedMultiplyAdd(-quotient, denominator, 1) - quotient * denominatorLow) / denominator;
      high = quotient + correction; low = quotient - high + correction;
      for (let n = .5; n <= order; n++) { host.tick(); multiplyDivide(x / 2, n); }
    } else for (let n = 1; n <= order; n++) { host.tick(); multiplyDivide(x / 2, n); }
    let totalHigh = high, totalLow = low;
    for (let k = 1; k < 10000; k++) {
      host.tick(); multiplyDivide(x / 2, k); multiplyDivide((modified ? 1 : -1) * x / 2, order + k);
      const combined = totalHigh + high, z = combined - totalHigh;
      const residual = (totalHigh - (combined - z)) + (high - z) + totalLow + low;
      totalHigh = combined + residual; totalLow = combined - totalHigh + residual;
      if (!Number.isFinite(totalHigh) || k >= 5 && Math.abs(high) <= Number.EPSILON / 1048576 * Math.abs(totalHigh)) return totalHigh + totalLow;
    }
    return totalHigh + totalLow;
  }
  let term = Math.exp(order * Math.log(x / 2) - logGamma(order + 1, host)), total = term;
  for (let k = 1; k < 10000; k++) {
    host.tick(); term *= (modified ? 1 : -1) * (x / (2 * k)) * (x / (2 * (order + k)));
    const next = total + term;
    if (next === total || !Number.isFinite(next)) return next;
    total = next;
  }
  return total;
}
function bessel(name: string, x: number, order: number, host: FunctionHost): number {
  if (x < 0) {
    if (name === "BESSELK") {
      host.diagnostic?.({ code: "numeric-warning", severity: "warning", message: "sf-bessel: trouble in bessel_k" });
      return NaN;
    }
    if (order !== Math.floor(order)) return NaN;
    return (order % 2 === 0 ? 1 : -1) * bessel(name, -x, order, host);
  }
  if (x === 0 && (name === "BESSELK" || name === "BESSELY" || name === "BESSELJ" && order < 0)) return NaN;
  if ((name === "BESSELJ" || name === "BESSELY") && x > 0 && x <= 1e12 && Number.isFinite(order) && besselPhaseDomain(x, order)) return capturedBesselPhase(x, order, name === "BESSELY", host);
  if (x > 0 && x * x < 105) {
    if (name === "BESSELJ" && order === -.5) return series(x, order, false, host);
    if (name === "BESSELY" && order === .5) return -series(x, -.5, false, host);
  }
  if (name === "BESSELI" && order === -.5 && x > 0 && x * x < 105) return series(x, order, true, host);
  if (order < 0) {
    const positive = -order, sine = sinPi(positive), cosine = piReduced(positive, true);
    if (name === "BESSELK" || name === "BESSELI" && sine === 0) return bessel(name, x, positive, host);
    if (name === "BESSELI") return bessel(name, x, positive, host) + 2 / Math.PI * sine * bessel("BESSELK", x, positive, host);
    const j = bessel("BESSELJ", x, positive, host), y = bessel("BESSELY", x, positive, host);
    return name === "BESSELJ" ? fusedMultiplyAdd(j, cosine, -y * sine) : fusedMultiplyAdd(j, sine, y * cosine);
  }
  if (name === "BESSELI") return x > 709 ? Infinity : order === 0 && x * x >= 100 ? capturedBesselI0(x, host) : series(x, order, true, host);
  if (name === "BESSELK" && x > 705.342) return 0;
  if (name === "BESSELK" && x > 1e-10) return capturedBesselK(x, order, host);
  if (name === "BESSELJ" && x * x < 10 * (order + 10)) return order === Math.floor(order) && order < 99999 ? capturedIntegerBesselJ(x, order, host) : series(x, order, false, host);
  if (name === "BESSELY" && x * x < 10 * (order + 10) && order === Math.floor(order) && order < 99999) return capturedIntegerBesselY(x, order, host);
  if ((name === "BESSELJ" || name === "BESSELY") && order === 0 && x >= 17 && x <= 1e6) return capturedZeroOrderHankel(x, name === "BESSELY", host);
  if ((name === "BESSELJ" || name === "BESSELY") && order === 0 && x >= 9 && x < 17) return capturedHankelIntegral(x, name === "BESSELY", host);
  if ((name === "BESSELJ" || name === "BESSELY") && order > 0 && x >= 17 && x <= 1e6 && (x - order) / Math.cbrt(x) >= 6.5) return capturedHankel(x, order, name === "BESSELY", host);
  if ((name === "BESSELJ" || name === "BESSELY") && order > 0 && x >= 9 && x <= 1e6 && (x - order) / Math.cbrt(x) > 1.5) return capturedHankelIntegral(x, name === "BESSELY", host, order);
  if ((name === "BESSELK" || name === "BESSELY") && order >= 2 && order === Math.floor(order)) {
    let previous = bessel(name, x, 0, host), current = bessel(name, x, 1, host);
    for (let n = 1; n < order; n++) { host.tick(); const next = fusedMultiplyAdd(2 * n / x, current, name === "BESSELK" ? previous : -previous); previous = current; current = next; if (!Number.isFinite(current)) break; }
    return current;
  }
  if ((name === "BESSELJ" || name === "BESSELY") && x > 32 + order * order) {
    const mu = 4 * order * order; let term = 1, previous = 1, p = 1, q = 0;
    for (let k = 1; k < 100; k++) {
      host.tick(); term *= (mu - (2 * k - 1) ** 2) / (8 * x * k);
      if (Math.abs(term) > previous) break;
      if (k % 2 === 0) p += (k % 4 === 0 ? 1 : -1) * term;
      else q += (k % 4 === 1 ? 1 : -1) * term;
      if (Math.abs(term) <= Number.EPSILON) break;
      previous = Math.abs(term);
    }
    const offset = (order % 4) / 2 + .25, sine = sinPi(offset), cosine = sinPi(offset + .5);
    // Keep the enormous input's phase; do not subtract a rounded multiple of pi.
    const s = Math.sin(x), c = Math.cos(x), phaseCos = c * cosine + s * sine, phaseSin = s * cosine - c * sine;
    return Math.sqrt(2 / Math.PI / x) * (name === "BESSELJ" ? phaseCos * p - phaseSin * q : phaseSin * p + phaseCos * q);
  }
  if (x === 0) return order === 0 ? 1 : 0;
  const endpoint = Math.max(4, Math.asinh(800 / x) + Math.log1p(order / x));
  if (name === "BESSELK") {
    const logCosh = (value: number) => Math.abs(value) + Math.log1p(Math.exp(-2 * Math.abs(value))) - Math.LN2;
    return integrate(t => Math.exp(-x * Math.cosh(t) + logCosh(order * t)), 0, endpoint, host);
  }
  const first = integrate(t => {
    const sine = Math.sin(t), a = x * sine, b = order * t, phase = a - b, z = phase - a;
    const low = (a - (phase - z)) - (b + z) + fusedMultiplyAdd(x, sine, -a) - fusedMultiplyAdd(order, t, -b);
    return name === "BESSELJ" ? fusedMultiplyAdd(-Math.sin(phase), low, Math.cos(phase)) : fusedMultiplyAdd(Math.cos(phase), low, Math.sin(phase));
  }, 0, Math.PI, host);
  const sine = sinPi(order), cosine = sinPi(order + .5);
  const second = name === "BESSELJ" && sine === 0 ? 0 : integrate(t => name === "BESSELJ"
    ? sine * Math.exp(-x * Math.sinh(t) - order * t)
    : Math.exp(-x * Math.sinh(t) + order * t) + cosine * Math.exp(-x * Math.sinh(t) - order * t), 0, endpoint, host);
  return (first - second) / Math.PI;
}
export const specialNumericFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ERFC: (args, host) => {
    const x = numberArg(args, 0, host);
    return numericResult(scalarErrorFunction(x, true, host));
  },
  ERF: (args, host) => {
    const lower = numberArg(args, 0, host);
    if (args[1] === undefined) return numericResult(scalarErrorFunction(lower, false, host));
    const upper = numberArg(args, 1, host);
    return numericResult(2 * normalInterval(lower * Math.SQRT2, upper * Math.SQRT2, host));
  },
  ...Object.fromEntries(["BESSELJ", "BESSELI", "BESSELK", "BESSELY"].map(name => [name, ((args, host) => {
    return numericResult(bessel(name, numberArg(args, 0, host), numberArg(args, 1, host), host));
  }) satisfies FunctionImplementation]))
};

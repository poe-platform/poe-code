import { capturedExp, fusedMultiplyAdd } from "./numeric-arithmetic.js";
import { capturedTrig } from "./captured-trigonometry.js";
import { piReduced, sinPi } from "./math.js";
import { c, multiply } from "./complex.js";
import type { FunctionHost } from "./types.js";
import { capturedAcos } from "./captured-acos.js";
import { capturedLog1p } from "./captured-log1p.js";

/** Correct double-rounded square roots by comparing exact fourth-power midpoints. */
function fourthRoot(x: number, host: FunctionHost): number {
  const view = new DataView(new ArrayBuffer(8));
  const parts = (bits: bigint): readonly [bigint, number] => {
    const exponent = Number(bits >> 52n);
    return [(bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n), exponent ? exponent - 1075 : -1074];
  };
  view.setFloat64(0, x); const [input, inputExponent] = parts(view.getBigUint64(0));
  view.setFloat64(0, Math.sqrt(Math.sqrt(x))); let bits = view.getBigUint64(0);
  const compare = (left: bigint, right: bigint): number => {
    const [a, ae] = parts(left), [b, be] = parts(right), exponent = Math.min(ae, be);
    const midpoint = (a << BigInt(ae - exponent)) + (b << BigInt(be - exponent));
    const power = midpoint ** 4n, powerExponent = 4 * (exponent - 1), common = Math.min(powerExponent, inputExponent);
    const difference = (input << BigInt(inputExponent - common)) - (power << BigInt(powerExponent - common));
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  };
  for (;;) {
    host.tick();
    const lower = compare(bits - 1n, bits), upper = compare(bits, bits + 1n);
    if (lower < 0 || lower === 0 && (bits & 1n)) bits--;
    else if (upper > 0 || upper === 0 && (bits & 1n)) bits++;
    else { view.setBigUint64(0, bits); return view.getFloat64(0); }
  }
}

/* SunPro rational approximation coefficients/profile:
 * Copyright (C) 1993 Sun Microsystems, Inc. All rights reserved.
 * Permission to use, copy, modify, and distribute this software is freely
 * granted, provided that this notice is preserved. */
const coefficients = {
  r0: [0.0, 0.0, 0.015624999999999995, -0.00018997929423885472, 1.8295404953270067e-06, -4.618326885321032e-09],
  s0: [0.0, 0.015619102946489001, 0.00011692678466333745, 5.135465502073181e-07, 1.1661400333379e-09],
  u0: [-0.07380429510868723, 0.17666645250918112, -0.01381856719455969, 0.00034745343209368365, -3.8140705372436416e-06, 1.9559013703502292e-08, -3.982051941321034e-11],
  v0: [0.01273048348341237, 7.600686273503533e-05, 2.591508518404578e-07, 4.4111031133267547e-10],
  r1: [-0.0625, 0.001407056669551897, -1.599556310840356e-05, 4.9672799960958445e-08],
  s1: [0.0, 0.019153759953836346, 0.00018594678558863092, 1.1771846404262368e-06, 5.0463625707621704e-09, 1.2354227442613791e-11],
  u1: [-0.19605709064623894, 0.05044387166398113, -0.0019125689587576355, 2.352526005616105e-05, -9.190991580398789e-08],
  v1: [0.01991673182366499, 0.00020255258102513517, 1.3560880109751623e-06, 6.227414523646215e-09, 1.6655924620799208e-11],
  pr80: [0.0, -0.07031249999999004, -8.081670412753498, -257.06310567970485, -2485.216410094288, -5253.043804907295],
  ps80: [116.53436461966818, 3833.7447536412183, 40597.857264847255, 116752.97256437592, 47627.728414673096],
  pr50: [-1.141254646918945e-11, -0.07031249408735993, -4.159610644705878, -67.67476522651673, -331.23129964917297, -346.4333883656049],
  ps50: [60.753938269230034, 1051.2523059570458, 5978.970943338558, 9625.445143577745, 2406.058159229391],
  pr30: [-2.547046017719519e-09, -0.07031196163814817, -2.409032215495296, -21.96597747348831, -58.07917047017376, -31.44794705948885],
  ps30: [35.85603380552097, 361.51398305030386, 1193.6078379211153, 1127.9967985690741, 173.58093081333575],
  pr20: [-8.875343330325264e-08, -0.07030309954836247, -1.4507384678095299, -7.635696138235278, -11.193166886035675, -3.2336457935133534],
  ps20: [22.22029975320888, 136.2067942182152, 270.4702786580835, 153.87539420832033, 14.65761769482562],
  qr80: [0.0, 0.0732421874999935, 11.76820646822527, 557.6733802564019, 8859.197207564686, 37014.62677768878],
  qs80: [163.77602689568982, 8098.344946564498, 142538.29141912048, 803309.2571195144, 840501.5798190605, -343899.2935378666],
  qr50: [1.8408596359451553e-11, 0.07324217666126848, 5.8356350896205695, 135.11157728644983, 1027.243765961641, 1989.9778586460538],
  qs50: [82.77661022365378, 2077.81416421393, 18847.28877857181, 56751.11228949473, 35976.75384251145, -5354.342756019448],
  qr30: [4.377410140897386e-09, 0.07324111800429114, 3.344231375161707, 42.621844074541265, 170.8080913405656, 166.73394869665117],
  qs30: [48.75887297245872, 709.689221056606, 3704.1482262011136, 6460.425167525689, 2516.3336892036896, -149.2474518361564],
  qr20: [1.5044444488698327e-07, 0.07322342659630793, 1.99819174093816, 14.495602934788574, 31.666231750478154, 16.252707571092927],
  qs20: [30.36558483552192, 269.34811860804984, 844.7837575953201, 882.9358451124886, 212.66638851179883, -5.3109549388266695],
  pr81: [0.0, 0.11718749999998865, 13.239480659307358, 412.05185430737856, 3874.7453891396053, 7914.479540318917],
  ps81: [114.20737037567841, 3650.9308342085346, 36956.206026903346, 97602.79359349508, 30804.27206278888],
  pr51: [1.3199051955624352e-11, 0.1171874931906141, 6.802751278684329, 108.30818299018911, 517.6361395331998, 528.7152013633375],
  ps51: [59.28059872211313, 991.4014187336144, 5353.26695291488, 7844.690317495512, 1504.0468881036106],
  pr31: [3.025039161373736e-09, 0.11718686556725359, 3.9329775003331564, 35.11940355916369, 91.05501107507813, 48.55906851973649],
  ps31: [34.79130950012515, 336.76245874782575, 1046.8713997577513, 890.8113463982564, 103.78793243963928],
  pr21: [1.0771083010687374e-07, 0.11717621946268335, 2.368514966676088, 12.242610914826123, 17.693971127168773, 5.073523125888185],
  ps21: [21.43648593638214, 125.29022716840275, 232.2764690571628, 117.6793732871471, 8.364638933716183],
  qr81: [0.0, -0.10253906249999271, -16.271753454459, -759.6017225139501, -11849.806670242959, -48438.512428575035],
  qs81: [161.3953697007229, 7825.385999233485, 133875.33628724958, 719657.7236832409, 666601.2326177764, -294490.26430383464],
  qr51: [-2.089799311417641e-11, -0.10253905024137543, -8.05644828123936, -183.66960747488838, -1373.1937606550816, -2612.4444045321566],
  qs51: [81.27655013843358, 1991.7987346048596, 17468.48519249089, 49851.42709103523, 27948.075163891812, -4719.183547951285],
  qr31: [-5.078312264617666e-09, -0.10253782982083709, -4.610115811394734, -57.847221656278364, -228.2445407376317, -219.21012847890933],
  qs31: [47.66515503237295, 673.8651126766997, 3380.1528667952634, 5547.729097207228, 1903.119193388108, -135.20119144430734],
  qr21: [-1.7838172751095887e-07, -0.10251704260798555, -2.7522056827818746, -19.663616264370372, -42.32531333728305, -21.371921170370406],
  qs21: [29.533362906052385, 252.98154998219053, 757.5028348686454, 739.3932053204672, 155.94900333666612, -4.959498988226282],
} as const;

function amplitude(x: number, order: 0 | 1, correction: boolean, host: FunctionHost): number {
  const anchor = correction ? order === 0 ? -.125 : .375 : 1;
  if (x >= 2 ** 28) return correction ? anchor / x : 1;
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x); const high = view.getUint32(0);
  const range = high >= 0x40200000 ? 8 : high >= 0x40122e8b ? 5 : high >= 0x4006db6d ? 3 : 2;
  const prefix = correction ? "q" : "p";
  const p = coefficients[`${prefix}r${range}${order}`], q = coefficients[`${prefix}s${range}${order}`];
  const z = 1 / (x * x), z2 = z * z, z4 = z2 * z2;
  host.tick();
  const r1 = fusedMultiplyAdd(z, p[1], p[0]), r2 = fusedMultiplyAdd(z, p[3], p[2]), r3 = fusedMultiplyAdd(z, p[5], p[4]);
  const r = fusedMultiplyAdd(z4, r3, fusedMultiplyAdd(z2, r2, r1));
  const s1 = fusedMultiplyAdd(z, q[0], 1), s2 = fusedMultiplyAdd(z, q[2], q[1]), s3 = fusedMultiplyAdd(z, q[4], q[3]);
  let s = fusedMultiplyAdd(z4, s3, fusedMultiplyAdd(z2, s2, s1));
  if (q.length === 6) s = fusedMultiplyAdd(z4 * z2, q[5]!, s);
  return correction ? (anchor + r / s) / x : 1 + r / s;
}

/** Captured glibc binary64 base functions for positive x. */
export function capturedBesselBase(x: number, order: 0 | 1, secondKind: boolean, host: FunctionHost): number {
  if (x < 2) {
    const z = x * x, z2 = z * z, z4 = z2 * z2;
    if (secondKind) {
      const u = order === 0 ? coefficients.u0 : coefficients.u1, v = order === 0 ? coefficients.v0 : coefficients.v1;
      if (x <= 2 ** (order === 0 ? -27 : -54)) return order === 0 ? fusedMultiplyAdd(.6366197723675814, Math.log(x), u[0]) : -.6366197723675814 / x;
      const u1 = fusedMultiplyAdd(z, u[1], u[0]), u2 = fusedMultiplyAdd(z, u[3], u[2]);
      let numerator = fusedMultiplyAdd(z2, u2, u1);
      numerator = order === 0 ? fusedMultiplyAdd(z4 * z2, u[6]!, fusedMultiplyAdd(z4, fusedMultiplyAdd(z, u[5]!, u[4]), numerator)) : fusedMultiplyAdd(z4, u[4], numerator);
      const v1 = fusedMultiplyAdd(z, v[0], 1), v2 = fusedMultiplyAdd(z, v[2], v[1]);
      const denominator = fusedMultiplyAdd(z4, order === 0 ? v[3] : fusedMultiplyAdd(z, v[4]!, v[3]), fusedMultiplyAdd(z2, v2, v1));
      const base = capturedBesselBase(x, order, false, host);
      return order === 0 ? fusedMultiplyAdd(.6366197723675814, base * Math.log(x), numerator / denominator)
        : fusedMultiplyAdd(.6366197723675814, fusedMultiplyAdd(base, Math.log(x), -1 / x), x * (numerator / denominator));
    }
    if (order === 0 && x < 2 ** -13) return x < 2 ** -27 ? 1 : fusedMultiplyAdd(-.25 * x, x, 1);
    if (order === 1 && x < 2 ** -27) return .5 * x;
    const r = order === 0 ? coefficients.r0 : coefficients.r1, s = order === 0 ? coefficients.s0 : coefficients.s1;
    const offset = order === 0 ? 2 : 0;
    const numerator = fusedMultiplyAdd(z4, r[offset + 3]!, fusedMultiplyAdd(z2, fusedMultiplyAdd(z, r[offset + 2]!, r[offset + 1]!), z * r[offset]!));
    const denominator = fusedMultiplyAdd(z4, order === 0 ? s[4] : fusedMultiplyAdd(z, s[5]!, s[4]), fusedMultiplyAdd(z2, fusedMultiplyAdd(z, s[3], s[2]), fusedMultiplyAdd(z, s[1], 1)));
    if (order === 1) return fusedMultiplyAdd(x, .5, numerator * x / denominator);
    return x < 1 ? fusedMultiplyAdd(z, -.25 + numerator / denominator, 1) : fusedMultiplyAdd(z, numerator / denominator, (1 + .5 * x) * (1 - .5 * x));
  }
  const s = Math.sin(x), c = Math.cos(x);
  let ss = order === 0 ? s - c : -s - c, cc = order === 0 ? s + c : s - c;
  if (x < 2 ** 1023) {
    const doubleCos = (order === 0 ? -1 : 1) * Math.cos(x + x);
    if (order === 0 ? s * c < 0 : s * c > 0) cc = doubleCos / ss;
    else ss = doubleCos / cc;
  }
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x);
  if (view.getUint32(0) > 0x48000000) return .5641895835477563 * (secondKind ? ss : cc) / Math.sqrt(x);
  const p = amplitude(x, order, false, host), q = amplitude(x, order, true, host);
  const combined = secondKind ? fusedMultiplyAdd(p, ss, q * cc) : fusedMultiplyAdd(p, cc, -q * ss);
  return .5641895835477563 * combined / Math.sqrt(x);
}

/** Forward/backward native recurrence, including its rescaling and underflow. */
export function capturedIntegerBesselJ(x: number, order: number, host: FunctionHost): number {
  if (order <= 1) return capturedBesselBase(x, order as 0 | 1, false, host);
  if (x === 0) return 0;
  if (order <= x) {
    let a = capturedBesselBase(x, 0, false, host), b = capturedBesselBase(x, 1, false, host);
    for (let n = 1; n < order; n++) { host.tick(); const temp = b; b = fusedMultiplyAdd(b, 2 * n / x, -a); a = temp; }
    return b;
  }
  if (x < 2 ** -29) {
    if (order > 33) return 0;
    let factorial = 1, power = x / 2;
    for (let n = 2; n <= order; n++) { host.tick(); factorial *= n; power *= x / 2; }
    return power / factorial;
  }
  const w = 2 * order / x, h = 2 / x;
  let q0 = w, z = w + h, q1 = fusedMultiplyAdd(w, z, -1), k = 1;
  while (q1 < 1e9) { host.tick(); k++; z += h; const next = fusedMultiplyAdd(z, q1, -q0); q0 = q1; q1 = next; }
  let t = 0;
  for (let i = 2 * (order + k); i >= 2 * order; i -= 2) { host.tick(); t = 1 / (i / x - t); }
  let a = t, b = 1;
  const rescale = order * Math.log(2 / x * order) >= 709.782712893384;
  for (let n = order - 1; n > 0; n--) {
    host.tick(); const previous = b; b = b * (2 * n) / x - a; a = previous;
    if (rescale && b > 1e100) { a /= b; t /= b; b = 1; }
  }
  const base0 = capturedBesselBase(x, 0, false, host), base1 = capturedBesselBase(x, 1, false, host);
  return Math.abs(base0) >= Math.abs(base1) ? t * base0 / b : t * base1 / a;
}

export function capturedIntegerBesselY(x: number, order: number, host: FunctionHost): number {
  if (order <= 1) return capturedBesselBase(x, order as 0 | 1, true, host);
  let a = capturedBesselBase(x, 0, true, host), b = capturedBesselBase(x, 1, true, host);
  for (let n = 1; n < order && Number.isFinite(b); n++) {
    host.tick(); const previous = b; b = fusedMultiplyAdd(2 * n / x, b, -a); a = previous;
  }
  return b;
}

/** Released Debye B1 evaluation for nonzero orders below the phase domain. */
export function capturedHankel(x: number, order: number, secondKind: boolean, host: FunctionHost): number {
  const g = Math.abs(x - order) / Math.cbrt(x), terms = g < 7 ? 17 : g < 10 ? 13 : g < 23 ? 9 : 5;
  const coefficients: number[][] = [[1], [.125, -5 / 24]];
  for (let n = 2; n <= terms; n++) {
    const previous = coefficients[n - 1]!, row: number[] = [];
    for (let j = n; j <= 3 * n; j += 2) {
      host.tick(); let value = 0;
      if (j < 3 * n) value += .5 * (j - 1) * previous[(j - n) / 2]!;
      if (j > n) value = fusedMultiplyAdd(-.5 * (j - 3), previous[(j - n - 2) / 2]!, value);
      if (j < 3 * n) value += .125 * previous[(j - n) / 2]! / j;
      if (j > n) value -= .625 * previous[(j - n - 2) / 2]! / j;
      row.push(value);
    }
    coefficients.push(row);
  }
  const difference = fusedMultiplyAdd(x, x, -order * order), p = order / Math.sqrt(difference);
  let real = 0, imaginary = 0, scale = 1;
  for (let n = 0; n <= terms; n++) {
    host.tick(); let value = 0;
    const row = coefficients[n]!;
    for (let i = n; i >= 0; i--) value = fusedMultiplyAdd(value, -p * p, row[i]!);
    value *= p ** n; if (n & 2) value = -value;
    if (n & 1) imaginary += value * scale; else real += value * scale;
    scale = -scale / order;
  }
  const q = order / x;
  let phase: number, piPhase: number, mainPhase: number;
  if (q < .1) {
    const anchors = [.5, 1 / 24, 1 / 80, 5 / 896, 7 / 2304, 21 / 11264, 33 / 26624, 143 / 163840, 715 / 1114112, 2431 / 4980736];
    let value = 0;
    for (let i = anchors.length - 1; i >= 0; i--) value = fusedMultiplyAdd(value, q * q, anchors[i]!);
    phase = value * q * order; mainPhase = x; piPhase = -order / 2 - .25;
  } else { phase = fusedMultiplyAdd(-order, capturedAcos(q, host), Math.sqrt(difference)); mainPhase = 0; piPhase = -.25; }
  const factor = Math.sqrt(2 / Math.PI) / fourthRoot(difference, host);
  let polar = c(factor * capturedTrig(phase, true), factor * capturedTrig(phase, false));
  if (mainPhase) polar = multiply(polar, c(capturedTrig(mainPhase, true), capturedTrig(mainPhase, false)));
  polar = multiply(polar, c(piReduced(piPhase, true), sinPi(piPhase)));
  const result = multiply(polar, c(real, imaginary));
  return secondKind ? result.im : result.re;
}

/** Zero-order Debye expansion with the captured upstream finite truncation. */
export function capturedZeroOrderHankel(x: number, secondKind: boolean, host: FunctionHost): number {
  const g = x / Math.cbrt(x), terms = g < 7 ? 17 : g < 10 ? 13 : g < 23 ? 9 : 5;
  let coefficient = 1, real = 1, imaginary = 0;
  for (let n = 1; n <= terms; n++) {
    host.tick(); coefficient = n === 1 ? .125 : .5 * (n - 1) * coefficient + .125 * coefficient / n;
    let term = coefficient / x ** n;
    if (n & 2) term = -term;
    if (n & 1) imaginary -= term; else real += term;
  }
  const factor = Math.sqrt(2 / Math.PI) / (x * x) ** .25;
  const polarReal = factor * capturedTrig(x, true), polarImaginary = factor * capturedTrig(x, false), rootHalf = .7071067811865476;
  const phaseReal = fusedMultiplyAdd(polarReal, rootHalf, polarImaginary * rootHalf);
  const phaseImaginary = fusedMultiplyAdd(-polarReal, rootHalf, polarImaginary * rootHalf);
  return secondKind ? fusedMultiplyAdd(phaseReal, imaginary, phaseImaginary * real) : fusedMultiplyAdd(phaseReal, real, -phaseImaginary * imaginary);
}

/** Steepest-descent Hankel integral, with cancellation-safe series
 * and the pinned finite quadrature/range-shrinking profile. */
export function capturedHankelIntegral(x: number, secondKind: boolean, host: FunctionHost, order = 0): number {
  const beta = capturedAcos(order / x, host), g = Math.abs(x - order) / Math.cbrt(x);
  const cosBeta = order / x, sinBeta = Math.sqrt(fusedMultiplyAdd(-cosBeta, cosBeta, 1));
  const power = g > 5 ? 1 : g > 4 ? 2 : g > 3 ? 3 : 4, count = g > 5 ? 25 : 47;
  const sample = (v: number): readonly [number, number] => {
    host.tick(); const sine = capturedTrig(v, false);
    if (sine <= 0) return [0, 0];
    const cosine = capturedTrig(v, true), d = v - beta, dd = d * d;
    let offset: number;
    if (Math.abs(d) > .1) offset = fusedMultiplyAdd(d, cosBeta, -(sine - sinBeta)) / sine;
    else {
      let odd = d, even = 1, total = 0;
      for (let n = 2; n < 100; n++) {
        host.tick(); let term: number;
        if (n & 1) { odd *= -dd / (n === 3 ? 3 : n * (n - 3)); term = odd * (cosine / sine); }
        else { even *= -dd / (n * (n - 3)); term = even; }
        total += term;
        if (Math.abs(term) <= Math.abs(total) * (Number.EPSILON / 16)) break;
      }
      offset = total;
    }
    let sinh = Math.sqrt(offset * (offset + 2)), u = capturedLog1p(sinh + offset);
    if (v < beta) { sinh = -sinh; u = -u; }
    let phase: number;
    if (Math.abs(d) < .1) {
      let t = 1, difference = 0;
      for (let n = 1; n < 100; n += 2) {
        host.tick(); t *= -d / n; difference = fusedMultiplyAdd(sinBeta, t, difference); t *= d / (n + 1); difference = fusedMultiplyAdd(cosBeta, t, difference);
        if (Math.abs(t) <= Math.abs(difference) * (Number.EPSILON / 16)) break;
      }
      let remainder = 0, term = u;
      if (!Number.isFinite(u)) remainder = u;
      else if (Math.abs(u) >= 1) remainder = Math.sinh(u) - u;
      else for (let n = 3; n < 100; n += 2) {
        host.tick(); term *= u * u / ((n - 1) * n); remainder += term;
        if (Math.abs(term) <= Math.abs(remainder) * (Number.EPSILON / 16)) break;
      }
      phase = fusedMultiplyAdd(remainder, cosBeta, difference * sinh);
    } else phase = fusedMultiplyAdd(cosine, sinh, -cosBeta * u);
    const derivative = fusedMultiplyAdd(-d * cosBeta, cosine, capturedTrig(d, false)), slope = derivative ? derivative / (sinh * sine * sine) : 0;
    const exponential = capturedExp(x * phase);
    return [slope * exponential, exponential];
  };
  const reference = sample(beta), threshold = Math.hypot(...reference) * Number.EPSILON;
  let lower = 0, upper = Math.PI;
  for (const side of [0, 1]) {
    let limit = beta, first = true;
    while ((side === 0 ? limit - lower : upper - limit) > Number.EPSILON) {
      host.tick(); const edge = side === 0 ? lower : upper, point = first ? edge : (limit + edge) / 2;
      const magnitude = Math.hypot(...sample(point)); first = false;
      if (magnitude <= threshold) {
        if (side === 0) lower = point; else upper = point;
        if (magnitude >= threshold / 16) break;
      } else limit = point;
    }
  }
  if (power !== 1) { lower **= 1 / power; upper **= 1 / power; }
  const step = (upper - lower) / count;
  let real = 0, imaginary = 0;
  for (let n = 0; n <= count; n++) {
    host.tick(); const t = fusedMultiplyAdd(n, step, lower), point = power === 1 ? t : t ** power;
    let [a, b] = sample(point);
    if (power !== 1) { const scale = power * t ** (power - 1); a *= scale; b *= scale; }
    if (n === 0 || n === count) { a *= .5; b *= .5; }
    real += a; imaginary += b;
  }
  real *= step; imaginary *= step;
  const angle = fusedMultiplyAdd(-order, beta, Math.sqrt(fusedMultiplyAdd(x, x, -order * order)));
  const c = capturedTrig(angle, true), s = capturedTrig(angle, false);
  return secondKind ? fusedMultiplyAdd(real, c, -imaginary * s) * (-1 / Math.PI) : fusedMultiplyAdd(real, s, imaginary * c) * (1 / Math.PI);
}

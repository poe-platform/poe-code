import { capturedCbrt } from "./captured-cbrt.js";
/* Gnumeric 1.12.61 Algorithms A2/A4 and captured glibc 2.41 primitives.
 * GNU C Library cube root: Copyright (C) 1997-2025 Free Software Foundation, Inc.
 * LGPL-2.1-or-later; see captured-bessel-transition-NOTICE.md.
 * Hyperbolic primitives: Copyright (C) 1993 Sun Microsystems, Inc.
 * All rights reserved. Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice is preserved.
 */
import { capturedExp, fusedMultiplyAdd as fma } from "./numeric-arithmetic.js";
import { capturedLog } from "./captured-log.js";
import { capturedLog1p } from "./captured-log1p.js";
import { capturedTrig } from "./captured-trigonometry.js";
import type { FunctionHost } from "./types.js";

// Private primitives preserve the captured quadrature arithmetic.
function expm1(input: number): number {
  if (!Number.isFinite(input)) return input === -Infinity ? -1 : input;
  if (input > 709.782712893384) return Infinity;
  if (input < -38.816242111356935) return -1;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, input);
  const hx = view.getUint32(0) & 2147483647;
  let x = input,
    k = 0,
    c = 0;
  if (hx > 1071001154) {
    let hi: number, lo: number;
    if (hx < 1072734898) {
      k = input < 0 ? -1 : 1;
      hi = input - k * 0.6931471803691238;
      lo = k * 1.9082149292705877e-10;
    } else {
      k = Math.trunc(input * 1.4426950408889634 + (input < 0 ? -0.5 : 0.5));
      hi = fma(-k, 0.6931471803691238, input);
      lo = k * 1.9082149292705877e-10;
    }
    x = hi - lo;
    c = hi - x - lo;
  } else if (hx < 1016070144) return x;
  const hfx = 0.5 * x,
    hxs = x * hfx,
    h2 = hxs * hxs,
    h4 = h2 * h2;
  const r1 = fma(
    h4,
    fma(hxs, -2.0109921818362437e-7, 0.000004008217827329362),
    fma(
      h2,
      fma(hxs, -0.0000793650757867488, 0.0015873015872548146),
      fma(hxs, -0.03333333333333313, 1)
    )
  );
  const t = fma(-r1, hfx, 3);
  let e = hxs * ((r1 - t) / fma(-x, t, 6));
  if (k === 0) return x - fma(x, e, -hxs);
  e = fma(x, e - c, -c) - hxs;
  if (k === -1) return fma(0.5, x - e, -0.5);
  if (k === 1) return x < -0.25 ? -2 * (e - (x + 0.5)) : fma(2, x - e, 1);
  const y =
    k <= -2 || k > 56 ? 1 - (e - x) : k < 20 ? 1 - 2 ** -k - (e - x) : x - (e + 2 ** -k) + 1;
  view.setFloat64(0, y);
  view.setUint32(0, view.getUint32(0) + (k << 20));
  return view.getFloat64(0) - (k <= -2 || k > 56 ? 1 : 0);
}
function sinh(x: number): number {
  const a = Math.abs(x),
    h = x < 0 ? -0.5 : 0.5;
  if (a < 2 ** -28) return x;
  if (a < 22) {
    const t = expm1(a);
    return h * (a < 1 ? 2 * t - (t * t) / (t + 1) : t + t / (t + 1));
  }
  return h * capturedExp(a);
}
function acosh(x: number): number {
  if (x < 1) return NaN;
  if (x === 1) return 0;
  if (x >= 2 ** 28) return capturedLog(x) + Math.LN2;
  if (x > 2) return capturedLog(2 * x - 1 / (x + Math.sqrt(fma(x, x, -1))));
  const t = x - 1;
  return capturedLog1p(t + Math.sqrt(fma(2, t, t * t)));
}
const legendre45_roots = [
  0, 0.0689869801631442, 0.137645205983253, 0.2056474897832637, 0.2726697697523776,
  0.3383926542506022, 0.4025029438585419, 0.4646951239196351, 0.5246728204629161,
  0.5821502125693532, 0.6368533944532233, 0.6885216807712006, 0.7369088489454904,
  0.7817843125939062, 0.8229342205020863, 0.8601624759606642, 0.8932916717532418,
  0.9221639367190004, 0.9466416909956291, 0.9666083103968947, 0.9819687150345405,
  0.9926499984472037, 0.9986036451819367
];
const legendre45_wts = [
  0.069041824829232, 0.0688773169776613, 0.0683845773786697, 0.0675659541636075, 0.0664253484498425,
  0.0649681957507234, 0.0632014400738199, 0.0611335008310665, 0.0587742327188417,
  0.0561348787597865, 0.053228016731269, 0.050067499237952, 0.0466683877183734, 0.043046880709165,
  0.0392202367293025, 0.035206692201609, 0.0310253749345155, 0.0266962139675777, 0.0222398475505787,
  0.0176775352579376, 0.0130311049915828, 0.0083231892962182, 0.0035826631552836
];
const legendre33_roots = [
  0.0, 0.0936310658547334, 0.1864392988279916, 0.277609097152497, 0.3663392577480734,
  0.4518500172724507, 0.5333899047863476, 0.610242345836379, 0.6817319599697428, 0.7472304964495622,
  0.8061623562741665, 0.8580096526765041, 0.9023167677434336, 0.9386943726111684,
  0.9668229096899927, 0.9864557262306425, 0.9974246942464552
];
const legendre33_wts = [
  0.09376844616021, 0.0933564260655961, 0.0921239866433168, 0.0900819586606386, 0.0872482876188443,
  0.0836478760670387, 0.0793123647948867, 0.0742798548439541, 0.0685945728186567,
  0.0623064825303175, 0.0554708466316636, 0.0481477428187117, 0.0404015413316696, 0.032300358632329,
  0.0239155481017495, 0.0153217015129347, 0.0066062278475874
];
const uCoefficients = [
  0.5773502691896257, 0.02566001196398337, 0.0014662863979419067, 9.775242652946044e-5,
  7.4525058224720925e-6, 6.154420726774332e-7, 5.290511846462804e-8, 4.652912673681862e-9,
  4.160632153588627e-10, 3.7712142304302015e-11, 3.456736209918445e-12, 3.1977726302920315e-13,
  2.980844117260716e-14, 2.7965280211260193e-15
];
const differenceCoefficients = [
  0.25660011963983365, 0.0, 0.0009775242652946044, 7.240920483663736e-5, 7.447803926054129e-6,
  7.413082229429168e-7, 7.442384401977746e-8, 7.486659157991586e-9, 7.541641219289175e-10,
  7.60486856423281e-11, 7.674813991223213e-12, 7.750262182753251e-13, 7.830282479161764e-14,
  7.914196802828771e-15, 8.001515011411917e-16, 8.091875423291504e-17, 8.18500434760158e-18
];
function integral(
  fn: (x: number) => [number, number],
  L: number,
  H: number,
  ref: number,
  host: Pick<FunctionHost, "tick">,
  near = false
): [number, number] {
  const roots = near ? legendre33_roots : legendre45_roots,
    weights = near ? legendre33_wts : legendre45_wts;
  const limit = Math.hypot(...fn(ref)) * Number.EPSILON;
  for (let side = 0; side < 2; side++) {
    let end = ref,
      first = true;
    while ((side ? H - end : end - L) > Number.EPSILON) {
      host.tick();
      const t = first ? (side ? H : L) : (end + (side ? H : L)) / 2;
      first = false;
      const y = Math.hypot(...fn(t));
      if (y <= limit) {
        if (side) H = t;
        else L = t;
        if (y >= limit / 16) break;
      } else end = t;
    }
  }
  const middle = (L + H) / 2,
    scale = (H - L) / 2;
  let a = 0,
    b = 0;
  for (let i = 0; i < roots.length; i++)
    for (let neg = 0; neg < 2; neg++) {
      const r = roots[i]!,
        w = weights[i]!;
      host.tick();
      const [x, y] = fn(middle + (neg ? -scale : scale) * r);
      a += x * w;
      b += y * w;
      if (i === 0) break;
    }
  return [a * scale, b * scale];
}
function sinDifference(v: number, s: number, host: Pick<FunctionHost, "tick">) {
  if (v >= 1) return fma(-v, capturedTrig(v, true), s);
  let r = 0,
    t = -v;
  for (let i = 3; i < 100; i += 2) {
    host.tick();
    t = (-t * (v * v)) / (i * (i === 3 ? 1 : i - 3));
    r += t;
    if (Math.abs(t) <= Math.abs(r) * (Number.EPSILON / 16)) break;
  }
  return r;
}
/** Native Algorithms A2/A4 outside the series, Debye and oscillatory domains. */
export function capturedBesselTransition(
  x: number,
  n: number,
  secondKind: boolean,
  host: Pick<FunctionHost, "tick">
): number {
  host.tick();
  const near = n <= x || (n - x) / capturedCbrt(x) <= 1.5;
  const ref = n < x ? 0 : -acosh(n / x),
    lo = ref - Math.max(capturedCbrt(300 / ((n + x) / 2)), 50 / Math.min(n, x));
  const a =
    integral((u) => [capturedExp(fma(x, sinh(u), -n * u)), 0], lo, near ? 0 : -ref, ref, host)[0] /
    -Math.PI;
  const b = integral(
    (v) => {
      if (near) {
        const sine = capturedTrig(v, false);
        let u = 0,
          difference = 0;
        if (v >= 1) {
          u = acosh(v / sine);
          difference = fma(-sinh(u), capturedTrig(v, true), u);
        } else {
          for (let i = uCoefficients.length - 1; i >= 0; i--) {
            host.tick();
            u = fma(u, v * v, uCoefficients[i]!);
          }
          u *= v;
          for (let i = differenceCoefficients.length - 1; i >= 0; i--) {
            host.tick();
            difference = fma(difference, v * v, differenceCoefficients[i]!);
          }
          difference *= v * (v * v);
        }
        const sh = sinh(u),
          slope = v ? sinDifference(v, sine, host) / (sine * sine * sh) : 0;
        const real = fma(-x, difference, (x - n) * u),
          imaginary = (x - n) * v;
        const e = capturedExp(real),
          r = e * capturedTrig(imaginary, true),
          i = e * capturedTrig(imaginary, false);
        return [fma(r, slope, -i), r + i * slope];
      }
      const s = capturedTrig(v, false),
        ch = (n / x) * (v ? v / s : 1),
        u = acosh(ch),
        sh = sinh(u),
        p = fma(x * sh, capturedTrig(v, true), -n * u),
        e = capturedExp(p);
      const slope = v ? (n * sinDifference(v, s, host)) / (x * s * s * sh) : 0;
      return [e * slope, e];
    },
    0,
    Math.PI,
    0,
    host,
    near
  );
  return secondKind ? a + b[0] * (-1 / Math.PI) : b[1] * (1 / Math.PI);
}

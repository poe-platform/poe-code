/* Gnumeric 1.12.61 Algorithm A2 and captured glibc 2.41 primitives.
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
function cbrt(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(x));
  const bits = view.getBigUint64(0);
  const e = Number(bits >> 52n) - 1022;
  view.setBigUint64(0, (bits & ((1n << 52n) - 1n)) | (1022n << 52n));
  const m = view.getFloat64(0);
  const coefficients = [
    0.35489576504391984, 1.508191937815849, -2.114994941673713, 2.4469312256353444,
    -1.8346927748361308, 0.7849323449766392, -0.14526389938548637
  ];
  let u = coefficients[6]!;
  for (let i = 5; i >= 0; i--) u = fma(u, m, coefficients[i]!);
  const t = u * u * u;
  const factor = [
    1 / 1.5874010519681996,
    1 / 1.2599210498948732,
    1,
    1.2599210498948732,
    1.5874010519681996
  ];
  return (
    Math.sign(x) *
    (((u * fma(2, m, t)) / fma(2, t, m)) * factor[2 + (e % 3)]!) *
    2 ** Math.trunc(e / 3)
  );
}
function integral(
  fn: (x: number) => [number, number],
  L: number,
  H: number,
  ref: number,
  host: Pick<FunctionHost, "tick">
): [number, number] {
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
  for (let i = 0; i < legendre45_roots.length; i++)
    for (let neg = 0; neg < 2; neg++) {
      const r = legendre45_roots[i]!,
        w = legendre45_wts[i]!;
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
/** Native Algorithm A2 for order > x, outside the series and Debye domains. */
export function capturedBesselTransition(
  x: number,
  n: number,
  secondKind: boolean,
  host: Pick<FunctionHost, "tick">
): number {
  host.tick();
  const ref = -acosh(n / x),
    lo = ref - Math.max(cbrt(300 / ((n + x) / 2)), 50 / Math.min(n, x));
  const a =
    integral((u) => [capturedExp(fma(x, sinh(u), -n * u)), 0], lo, -ref, ref, host)[0] / -Math.PI;
  const b = integral(
    (v) => {
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
    host
  );
  return secondKind ? a + b[0] * (-1 / Math.PI) : b[1] * (1 / Math.PI);
}

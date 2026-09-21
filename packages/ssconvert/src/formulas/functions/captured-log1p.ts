/* Copyright (C) 1993 Sun Microsystems, Inc. All rights reserved.
 * Permission to use, copy, modify, and distribute this software is freely
 * granted, provided that this notice is preserved. */

/** SunPro/glibc 2.41 log1p operation order for the captured aarch64 profile. */
export function capturedLog1p(x: number): number {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x);
  const hx = view.getInt32(0), ax = hx & 0x7fffffff;
  let k = 1, f = 0, hu = 0, correction = 0;
  if (hx < 0x3fda827a) {
    if (ax >= 0x3ff00000) return x === -1 ? -Infinity : NaN;
    if (ax < 0x3e200000) return ax < 0x3c900000 ? x : x - x * x * .5;
    if (hx > 0 || hx <= -1076707645) { k = 0; f = x; hu = 1; }
  } else if (hx >= 0x7ff00000) return x + x;
  if (k !== 0) {
    let u = hx < 0x43400000 ? 1 + x : x;
    view.setFloat64(0, u); hu = view.getUint32(0); k = (hu >> 20) - 1023;
    if (hx < 0x43400000) correction = (k > 0 ? 1 - (u - x) : x - (u - 1)) / u;
    hu &= 0x000fffff;
    if (hu < 0x6a09e) view.setUint32(0, hu | 0x3ff00000);
    else { k++; view.setUint32(0, hu | 0x3fe00000); hu = (0x00100000 - hu) >> 2; }
    u = view.getFloat64(0); f = u - 1;
  }
  const hi = .6931471803691238, lo = 1.9082149292705877e-10, halfSquare = .5 * f * f;
  if (hu === 0) {
    if (f === 0) return k === 0 ? 0 : k * hi + (correction + k * lo);
    const r = halfSquare * (1 - .6666666666666666 * f);
    return k === 0 ? f - r : k * hi - ((r - (k * lo + correction)) - f);
  }
  const s = f / (2 + f), z = s * s, z2 = z * z, z4 = z2 * z2, z6 = z4 * z2;
  const r1 = z * .6666666666666735, r2 = .3999999999940942 + z * .2857142874366239;
  const r3 = .22222198432149784 + z * .1818357216161805, r4 = .15313837699209373 + z * .14798198605116586;
  const r = r1 + z2 * r2 + z4 * r3 + z6 * r4;
  return k === 0 ? f - (halfSquare - s * (halfSquare + r)) : k * hi - ((halfSquare - (s * (halfSquare + r) + (k * lo + correction))) - f);
}

/*
 * Float tangent polynomial adapted from fdlibm.
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 * Developed at SunPro, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this software is freely
 * granted, provided that this notice is preserved.
 */
const f = Math.fround;
const coefficients = Float32Array.of(
  3.3333334327e-1, 1.3333334029e-1, 5.3968254477e-2, 2.1869488060e-2,
  8.8632395491e-3, 3.5920790397e-3, 1.4562094584e-3, 5.8804126456e-4,
  2.4646313977e-4, 7.8179444245e-5, 7.1407252108e-5, -1.8558637748e-5, 2.5907305826e-5
);
const bits = new DataView(new ArrayBuffer(4));
function truncate(value: number): number {
  bits.setFloat32(0, value);
  bits.setUint32(0, bits.getUint32(0) & 0xfffff000);
  return bits.getFloat32(0);
}

// Soundfield angles lie between -pi and pi.
export function soundfieldTangent(angle: number): number {
  const quadrant = Math.round(angle / (Math.PI / 2));
  const remainder = angle - quadrant * (Math.PI / 2);
  let x = f(remainder), y = f(remainder - x);
  const inverse = quadrant % 2 ? -1 : 1;
  const absolute = Math.abs(x), sign = x < 0 ? -1 : 1;
  if (absolute < 2 ** -28) return inverse === 1 ? x : -1 / x;
  if (absolute >= f(0.6744)) {
    x *= sign; y *= sign;
    x = f(f(f(0.78539812565) - x) + f(f(3.7748947079e-8) - y));
    y = 0;
    if (Math.abs(x) < 2 ** -13) return f(sign * inverse * f(1 - f(2 * inverse * x)));
  }
  const z = f(x * x), fourth = f(z * z), cube = f(z * x);
  let odd = coefficients[11]!, even = coefficients[12]!;
  for (let i = 9; i >= 1; i -= 2) odd = f(coefficients[i]! + f(fourth * odd));
  for (let i = 10; i >= 2; i -= 2) even = f(coefficients[i]! + f(fourth * even));
  let r = f(y + f(z * f(f(cube * f(odd + f(z * even))) + y)));
  r = f(r + f(coefficients[0]! * cube));
  const w = f(x + r);
  if (absolute >= f(0.6744)) return f(sign * f(inverse - f(2 * f(x - f(f(f(w * w) / f(w + inverse)) - r)))));
  if (inverse === 1) return w;
  const truncated = truncate(w), residual = f(r - f(truncated - x));
  const reciprocal = f(-1 / w), high = truncate(reciprocal);
  return f(high + f(reciprocal * f(f(1 + f(high * truncated)) + f(high * residual))));
}

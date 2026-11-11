/*
 * Float arctangent reduction and coefficients adapted from fdlibm.
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 * Developed at SunPro, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this software is freely
 * granted, provided that this notice is preserved.
 */
const f = Math.fround;
const high = Float32Array.of(0.46364760399, 0.78539812565, 0.98279368877, 1.5707962513);
const low = Float32Array.of(5.012158244e-9, 3.7748947079e-8, 3.447321717e-8, 7.5497894159e-8);
const coefficients = Float32Array.of(
  0.33333334327, -0.20000000298, 0.14285714924, -0.11111110449,
  0.090908870101, -0.076918758452, 0.066610731184, -0.058335702866,
  0.049768779427, -0.036531571299, 0.016285819933
);

// FFmpeg's atan2f rounds the ratio, argument reduction and polynomial in
// single precision. Rounding Math.atan2 only at the end changes PCM samples.
export function phaseAngle(y: number, x: number): number {
  if (x === 0 || y === 0 || !Number.isFinite(x) || !Number.isFinite(y)) return f(Math.atan2(y, x));
  let value = f(Math.abs(y / x));
  let angle: number;
  if (value >= 2 ** 25) angle = f(high[3]! + low[3]!);
  else if (value < 2 ** -29) angle = value;
  else {
    let region = -1;
    if (value >= 0.4375) {
      if (value < 0.6875) { region = 0; value = f(f(2 * value - 1) / f(2 + value)); }
      else if (value < 1.1875) { region = 1; value = f(f(value - 1) / f(value + 1)); }
      else if (value < 2.4375) { region = 2; value = f(f(value - 1.5) / f(1 + f(1.5 * value))); }
      else { region = 3; value = f(-1 / value); }
    }
    const square = f(value * value), fourth = f(square * square);
    let even = coefficients[10]!, odd = coefficients[9]!;
    for (let i = 8; i >= 0; i -= 2) even = f(coefficients[i]! + f(fourth * even));
    for (let i = 7; i >= 1; i -= 2) odd = f(coefficients[i]! + f(fourth * odd));
    const correction = f(value * f(f(square * even) + f(fourth * odd)));
    angle = region < 0 ? f(value - correction) : f(high[region]! - f(f(correction - low[region]!) - value));
  }
  if (x > 0) return y < 0 ? -angle : angle;
  const adjusted = f(angle - f(-8.7422776573e-8));
  return y < 0 ? f(adjusted - f(Math.PI)) : f(f(Math.PI) - adjusted);
}

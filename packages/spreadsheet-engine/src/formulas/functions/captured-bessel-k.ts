import { capturedExp, fusedMultiplyAdd as fma } from "./numeric-arithmetic.js";
import type { FunctionHost } from "./types.js";

// Cody's binary64 K recurrence and rational starting values, qualified against
// the captured Gnumeric 1.12.61 ARM64 operation profile. Invocation owns all state.
const gammaP = [0.8056298756904329, 20.404550020536515, 157.7056051066762, 536.6711164692075, 900.3827592912887, 730.9238866506604, 229.29930150942513, 0.8224670334241132];
const gammaQ = [29.460198624785043, 277.5778685102212, 1206.7032559102745, 2762.9144415979154, 3443.740505065646, 2210.6319011337864, 572.2673383598922];
const reflectionR = [-0.48672575865218404, 13.079485869097804, -101.96490580880537, 347.65409106507815, 0.0003495898124521935];
const reflectionS = [-25.57910550997646, 212.57260432226545, -610.6901868494411, 422.6966880577776];
const sinhT = [1.6125990452916364e-10, 2.5051878502858254e-08, 2.7557319615147965e-06, 0.00019841269840928374, 0.008333333333333475, 0.16666666666666666];

/** Positive x > 1e-10; tiny-input overflow is handled by the caller. */
export function capturedBesselK(x: number, order: number, host: FunctionHost): number {
  const integer = Math.floor(order), fraction = order - integer, shift = fraction > .5 ? 1 : 0;
  const nu = fraction < 1.49e-154 ? 0 : fraction - shift;
  const square = nu * nu, twice = 2 * nu, end = integer + shift;
  let first: number, second: number, ratio = 0;
  if (x <= 1) {
    let d1 = 0, d2 = gammaP[0]!, t1 = 1, t2 = gammaQ[0]!;
    for (let i = 2; i <= 7; i += 2) {
      host.tick(); d1 = fma(square, d1, gammaP[i - 1]!); d2 = fma(square, d2, gammaP[i]!);
      t1 = fma(square, t1, gammaQ[i - 1]!); t2 = fma(square, t2, gammaQ[i]!);
    }
    d1 *= nu; t1 *= nu;
    const logx = Math.log(x), offset = .11593151565841245;
    let f0 = fma(nu, gammaP[7]! - nu * (d1 + d2) / (t1 + t2), offset) - logx;
    let q0 = capturedExp(-nu * (offset - nu * (gammaP[7]! + nu * (d1 - d2) / (t1 - t2)) - logx));
    let f1 = nu * f0, p0 = capturedExp(f1);
    d1 = reflectionR[4]!; t1 = 1;
    for (let i = 0; i < 4; i++) { host.tick(); d1 = fma(square, d1, reflectionR[i]!); t1 = fma(square, t1, reflectionS[i]!); }
    if (Math.abs(f1) <= .5) {
      f1 *= f1; d2 = 0;
      for (const coefficient of sinhT) { host.tick(); d2 = fma(f1, d2, coefficient); }
      d2 = fma(f0 * f1, d2, f0);
    } else d2 = Math.sinh(f1) / nu;
    f0 = d2 - nu * d1 / (t1 * p0);
    let c = 1, denominator = -square, index = 0;
    const step = x * x / 4;
    p0 *= .5; q0 *= .5; f1 = f0; const f2 = p0;
    first = 0; second = 0;
    for (;;) {
      host.tick(); index++; denominator += 2 * index - 1; c = step * c / index;
      f0 = (fma(index, f0, p0) + q0) / denominator;
      p0 /= index - nu; q0 /= index + nu;
      const term1 = c * f0, term2 = c * fma(-index, f0, p0);
      first += term1; second += term2;
      if (Math.abs(term1 / (f1 + first)) <= Number.EPSILON && Math.abs(term2 / (f2 + second)) <= Number.EPSILON) break;
    }
    first += f1; second = 2 * (f2 + second) / x;
  } else {
    const twiceX = 2 * x;
    let tail = 0;
    if (x <= 4) {
      let depth = Math.trunc(52.0583 / x + 5.7607), d1 = 2 * depth, d2 = (depth - .5) ** 2;
      for (let i = 2; i <= depth; i++) { host.tick(); d1 -= 2; d2 -= d1; ratio = (-square + d2) / (twiceX + d1 - ratio); }
      depth = Math.trunc(fma(2.7782, x, 14.4303));
      const absolute = Math.abs(nu), twiceOrder = 2 * absolute, normalMinimum = 2.2250738585072014e-308;
      let remaining = depth, f1 = normalMinimum, f0 = (2 * (absolute + remaining) / x + .5 * x / (absolute + remaining + 1)) * normalMinimum;
      for (let i = 3; i <= depth; i++) {
        host.tick(); remaining--; let f2 = (twiceOrder + remaining + remaining) * f0;
        tail = (1 + (twiceOrder - 1) / remaining) * (f2 + tail);
        f2 = f2 / x + f1; f1 = f0; f0 = f2;
      }
      f1 = (twiceOrder + 2) * f0 / x + f1;
      let p = 0, q = 1;
      for (let i = 0; i < 7; i++) { host.tick(); p = fma(absolute, p, gammaP[i]!); q = fma(absolute, q, gammaQ[i]!); }
      const p0 = capturedExp(absolute * (fma(absolute, gammaP[7]! - absolute * p / q, .11593151565841245) - Math.log(x))) / x;
      const f2 = (absolute + .5 - ratio) * f1 / x;
      first = fma((fma(twiceOrder, f0, -f2) + f0 + tail) / (f2 + f1 + f0), p0, p0) * capturedExp(-x);
    } else {
      const depth = Math.trunc(185.3004 / x + 9.3715);
      let remaining = depth, d2 = (remaining - .5) ** 2, d1 = 2 * remaining;
      for (let i = 2; i <= depth; i++) {
        host.tick(); remaining--; d1 -= 2; d2 -= d1;
        ratio = (-square + d2) / (twiceX + d1 - ratio); tail = fma(ratio, tail, ratio) / remaining;
      }
      first = 1 / (fma(.7978845608028654, tail, .7978845608028654) * Math.sqrt(x)) * capturedExp(-x);
    }
    second = first + first * (nu + .5 - ratio) / x;
  }
  if (end === 0) return first;
  let previous = first, current = second;
  const stableLimit = x <= 1 ? fma(41.8341, x, 7.1075) : x <= 4 ? fma(6.4306, x, 42.511) : fma(1.35633, x - Math.abs(x - 20), 84.5096);
  const directEnd = Math.min(Math.trunc(stableLimit - nu), end);
  let n = 2;
  for (; n <= directEnd; n++) {
    host.tick(); const next = fma((twice + 2 * (n - 1)) / x, current, previous); previous = current; current = next;
    if (!Number.isFinite(current)) return current;
  }
  ratio = current / previous;
  for (; n <= end; n++) {
    host.tick(); ratio = (twice + 2 * (n - 1)) / x + 1 / ratio; current *= ratio;
    if (!Number.isFinite(current)) return current;
  }
  return current;
}

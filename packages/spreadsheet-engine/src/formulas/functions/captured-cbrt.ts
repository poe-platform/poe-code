/* GNU C Library, Copyright (C) 1997-2025 Free Software Foundation, Inc.
 * LGPL-2.1-or-later; see captured-bessel-transition-NOTICE.md and
 * ../../encoding/LGPL-2.1.txt. */
import { fusedMultiplyAdd as fma } from "./numeric-arithmetic.js";
/** Captured glibc cube root for the positive normal Bessel domain inputs. */
export function capturedCbrt(x: number): number {
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

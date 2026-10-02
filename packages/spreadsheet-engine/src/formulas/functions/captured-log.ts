// GNU C Library, Copyright (C) 2018-2025 Free Software Foundation, Inc.
// LGPL-2.1-or-later; see captured-log-NOTICE.md and ../../encoding/LGPL-2.1.txt.
import { fusedMultiplyAdd as fma } from "./numeric-arithmetic.js";
import { nearPolynomial as B, logPolynomial as A, logTable } from "./captured-log-profile.js";

/** glibc 2.41 binary64 logarithm for the pinned aarch64 numeric profile. */
export function capturedLog(x: number): number {
  if (x === 0) return -Infinity;
  if (!(x > 0)) return NaN;
  if (x === Infinity) return x;
  if (x >= .9375 && x < 1.064697265625) {
    const r = x - 1, r2 = r * r, r3 = r * r2;
    const p3 = fma(r3, B[10], fma(r2, B[9], fma(r, B[8], B[7])));
    const p2 = fma(r3, p3, fma(r2, B[6], fma(r, B[5], B[4])));
    const p1 = fma(r3, p2, fma(r2, B[3], fma(r, B[2], B[1])));
    const w = r * 2 ** 27, rhi = r + w - w, rlo = r - rhi;
    const square = rhi * rhi * B[0], hi = r + square;
    const lo = fma(B[0] * rlo, rhi + r, r - hi + square);
    return fma(r3, p1, lo) + hi;
  }
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x); let bits = view.getBigUint64(0);
  if (bits >> 52n === 0n) { view.setFloat64(0, x * 2 ** 52); bits = view.getBigUint64(0) - (52n << 52n); }
  const tmp = BigInt.asUintN(64, bits - 0x3fe6000000000000n);
  const index = Number(tmp >> 45n & 127n), k = Number(BigInt.asIntN(64, tmp) >> 52n);
  view.setBigUint64(0, BigInt.asUintN(64, bits - (tmp & (0xfffn << 52n))));
  const [invc, logc] = logTable[index]!;
  const r = fma(view.getFloat64(0), invc, -1), r2 = r * r;
  const w = fma(k, .6931471805598903, logc), hi = w + r;
  const lo = fma(k, 5.497923018708371e-14, w - hi + r);
  const polynomial = fma(r2, fma(r, A[4], A[3]), fma(r, A[2], A[1]));
  return fma(r * r2, polynomial, fma(r2, A[0], lo)) + hi;
}

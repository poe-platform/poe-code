// IBM Accurate Mathematical Library, Copyright (C) 2001-2025 Free Software Foundation, Inc.
// LGPL-2.1-or-later; see captured-acos-NOTICE.md and ../../encoding/LGPL-2.1.txt.

import { fusedMultiplyAdd } from "./numeric-arithmetic.js";
import type { FunctionHost } from "./types.js";
import { asinCoefficients, inverseRoots } from "./captured-acos-profile.js";

const halfPi = 1.5707963267948966, halfPiLow = 6.123233995736766e-17;
const f = [0.1666666666666641, 0.07500000000261227, 0.044642856142105974, 0.03038212685821193, 0.022355121102652562, 0.018138290340456505];
/** Compiled scalar acos operation order for the captured aarch64 glibc 2.41 profile. */
export function capturedAcos(x: number, host: Pick<FunctionHost, "tick">): number {
  host.tick();
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x);
  const high = view.getUint32(0), magnitude = high & 0x7fffffff;
  if (magnitude < 0x3c880000) return halfPi;
  if (magnitude < 0x3fc00000) {
    const square = x * x;
    let polynomial = f[5]!;
    for (let i = 4; i >= 0; i--) { host.tick(); polynomial = fusedMultiplyAdd(polynomial, square, f[i]!); }
    const r = halfPi - x;
    const correction = fusedMultiplyAdd(-polynomial, square * x, ((halfPi - r) - x) + halfPiLow);
    return r + correction;
  }
  if (magnitude < 0x3fef0000) {
    let index: number, degree: number;
    if (magnitude < 0x3fe00000) {
      index = magnitude < 0x3fd00000 ? 11 * ((magnitude & 0xfffff) >> 15) : 352 + 11 * ((magnitude & 0xfffff) >> 14); degree = 6;
    } else if (magnitude < 0x3fe80000) { index = 1056 + ((magnitude & 0xfe000) >> 11) * 3; degree = 7; }
    else if (magnitude < 0x3fed8000) { index = 992 + ((magnitude & 0xfe000) >> 13) * 13; degree = 8; }
    else if (magnitude < 0x3fee8000) { index = 884 + ((magnitude & 0xfe000) >> 13) * 14; degree = 9; }
    else { index = 768 + ((magnitude & 0xfe000) >> 13) * 15; degree = 10; }
    const delta = Math.abs(x) - asinCoefficients[index]!;
    let polynomial = asinCoefficients[index + degree]!;
    for (let i = degree - 1; i >= 2; i--) { host.tick(); polynomial = fusedMultiplyAdd(polynomial, delta, asinCoefficients[index + i]!); }
    const residual = fusedMultiplyAdd(delta, asinCoefficients[index + 1]!, fusedMultiplyAdd(delta * delta, polynomial, asinCoefficients[index + degree + 1]!));
    const anchor = asinCoefficients[index + degree + 2]!;
    return x > 0 ? (halfPi - anchor) + (halfPiLow - residual) : (halfPi + anchor) + (residual + halfPiLow);
  }
  if (magnitude < 0x3ff00000) {
    const z = .5 * (x > 0 ? 1 - x : 1 + x); view.setFloat64(0, z); const zh = view.getUint32(0);
    let t = inverseRoots[(zh & 0x1fffff) >> 14]! * 2 ** (511 - (zh >> 21));
    const r = fusedMultiplyAdd(-(t * t), z, 1);
    const rt = [0.9999999998599908, 0.4999999994959554, 0.3750175008673452, 0.31252362655451865];
    t *= fusedMultiplyAdd(r, fusedMultiplyAdd(r, fusedMultiplyAdd(r, rt[3]!, rt[2]!), rt[1]!), rt[0]!);
    const c = t * z; t = c * fusedMultiplyAdd(-(.5 * t), c, 1.5);
    const y = fusedMultiplyAdd(134217728, c, c) - 134217728 * c;
    const cc = fusedMultiplyAdd(-y, y, z) / (t + y);
    let polynomial = f[5]!;
    for (let i = 4; i >= 0; i--) { host.tick(); polynomial = fusedMultiplyAdd(polynomial, z, f[i]!); }
    polynomial *= z;
    const correction = x < 0 ? fusedMultiplyAdd(-(y + cc), polynomial, halfPiLow - cc) : fusedMultiplyAdd(polynomial, y + cc, cc);
    const result = (x < 0 ? halfPi - y : y) + correction;
    return result + result;
  }
  return magnitude === 0x3ff00000 && view.getUint32(4) === 0 ? x > 0 ? 0 : 2 * halfPi : NaN;
}

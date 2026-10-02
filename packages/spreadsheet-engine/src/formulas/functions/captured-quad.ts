// Paired arithmetic adapted from GOffice go-quad.c by Morten Welinder,
// under GNU GPL version 2 or, at your option, version 3, without warranty.
// The package LICENSE contains the GPL version 2 terms used here.
import { fusedMultiplyAdd } from "./numeric-arithmetic.js";
export type Pair = readonly [number, number];
export function add(a: Pair, b: Pair): Pair {
  const r = a[0] + b[0], s = Math.abs(a[0]) > Math.abs(b[0]) ? a[0] - r + b[0] + b[1] + a[1] : b[0] - r + a[0] + a[1] + b[1];
  const h = r + s; return [h, r - h + s];
}
export function subtract(a: Pair, b: Pair): Pair {
  const r = a[0] - b[0], s = Math.abs(a[0]) > Math.abs(b[0]) ? a[0] - r - b[0] - b[1] + a[1] : -b[0] - r + a[0] + a[1] - b[1];
  const h = r + s; return [h, r - h + s];
}
function split(x: number): Pair {
  let p = x * 134217729, scale = 1;
  if (!Number.isFinite(p) && Number.isFinite(x)) { x *= Number.EPSILON; p = x * 134217729; scale = 1 / Number.EPSILON; }
  const h = x - p + p;
  return [h * scale, (x - h) * scale];
}
export function product(x: number, y: number): Pair {
  const [xh, xl] = split(x), [yh, yl] = split(y), p = xh * yh;
  const q = fusedMultiplyAdd(xh, yl, xl * yh), h = p + q;
  return [h, fusedMultiplyAdd(xl, yl, p - h + q)];
}
export function multiply(a: Pair, b: Pair): Pair {
  const c = product(a[0], b[0]), l = fusedMultiplyAdd(a[0], b[1], a[1] * b[0]) + c[1], h = c[0] + l;
  return [h, c[0] - h + l];
}
export function divide(a: Pair, b: Pair): Pair {
  const c = a[0] / b[0], u = product(c, b[0]), l = fusedMultiplyAdd(-c, b[1], a[0] - u[0] - u[1] + a[1]) / b[0], h = c + l;
  return [h, c - h + l];
}

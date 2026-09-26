import { SsconvertError } from "../../contracts.js";
import type { FunctionHost } from "./types.js";

type Quad = readonly [number, number];
type QuadMatrix = Quad[][];
interface QR { readonly r: QuadMatrix; readonly v: QuadMatrix }

function add(a: Quad, b: Quad): Quad {
  const high = a[0] + b[0], split = high - a[0];
  const low = (a[0] - (high - split)) + (b[0] - split) + a[1] + b[1];
  const result = high + low;
  return [result, low - (result - high)];
}
function subtract(a: Quad, b: Quad): Quad { return add(a, [-b[0], -b[1]]); }
function split(x: number): Quad {
  const scaled = Math.abs(x) > 2 ** 996, value = scaled ? x * 2 ** -28 : x;
  const temporary = 134217729 * value, high = temporary - (temporary - value), low = value - high;
  return scaled ? [high * 2 ** 28, low * 2 ** 28] : [high, low];
}
function multiply(a: Quad, b: Quad): Quad {
  const high = a[0] * b[0];
  if (!Number.isFinite(high)) return [high, 0];
  const x = split(a[0]), y = split(b[0]);
  const low = ((x[0] * y[0] - high) + x[0] * y[1] + x[1] * y[0]) + x[1] * y[1] + a[0] * b[1] + a[1] * b[0];
  const result = high + low;
  return [result, low - (result - high)];
}
function divide(a: Quad, b: Quad): Quad {
  const high = a[0] / b[0];
  if (!Number.isFinite(high)) return [high, 0];
  const remainder = subtract(a, multiply([high, 0], b)), low = (remainder[0] + remainder[1]) / b[0];
  return add([high, 0], [low, 0]);
}
function squareRoot(a: Quad): Quad {
  const high = Math.sqrt(a[0]);
  if (high === 0 || !Number.isFinite(high)) return [high, 0];
  const remainder = subtract(a, multiply([high, 0], [high, 0]));
  return add([high, 0], [(remainder[0] + remainder[1]) / (2 * high), 0]);
}
function matrix(rows: number, columns: number, host: FunctionHost): QuadMatrix {
  if (rows * columns > host.context.limits.cells)
    throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
  return Array.from({ length: rows }, () => Array.from({ length: columns }, (): Quad => { host.tick(); return [0, 0]; }));
}
function transpose(a: QuadMatrix, host: FunctionHost): QuadMatrix {
  const result = matrix(a[0]!.length, a.length, host);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < a[0]!.length; j++) { host.tick(); result[j]![i] = a[i]![j]!; }
  return result;
}
function matrixProduct(a: QuadMatrix, b: QuadMatrix, host: FunctionHost): QuadMatrix {
  const result = matrix(a.length, b[0]!.length, host);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b[0]!.length; j++) {
    let retained: Quad = [0, 0];
    for (let k = 0; k < b.length; k++) { host.tick(); retained = add(retained, multiply(a[i]![k]!, b[k]![j]!)); }
    result[i]![j] = retained;
  }
  return result;
}
/** Householder QR with two-component arithmetic, in the upstream traversal order. */
function factor(a: QuadMatrix, host: FunctionHost): QR {
  const m = a.length, n = a[0]!.length, r = matrix(m, n, host), v = matrix(m, n, host);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) { host.tick(); r[i]![j] = a[i]![j]!; }
  for (let k = 0; k < n; k++) {
    let norm: Quad = [0, 0], previous: Quad = norm;
    for (let i = m - 1; i >= k; i--) { host.tick(); v[i]![k] = r[i]![k]!; previous = norm; norm = add(norm, multiply(v[i]![k]!, v[i]![k]!)); }
    const length = squareRoot(norm);
    v[k]![k] = r[k]![k]![0] < 0 ? subtract(v[k]![k]!, length) : add(v[k]![k]!, length);
    const divisor = squareRoot(add(previous, multiply(v[k]![k]!, v[k]![k]!)));
    if (divisor[0] === 0) continue;
    for (let i = k; i < m; i++) { host.tick(); v[i]![k] = divide(v[i]![k]!, divisor); }
    for (let j = k; j < n; j++) {
      let retained: Quad = [0, 0];
      for (let i = k; i < m; i++) { host.tick(); retained = add(retained, multiply(v[i]![k]!, r[i]![j]!)); }
      for (let i = k; i < m; i++) { host.tick(); const p = multiply(v[i]![k]!, retained); r[i]![j] = subtract(r[i]![j]!, add(p, p)); }
    }
    for (let i = k + 1; i < m; i++) { host.tick(); r[i]![k] = [0, 0]; }
  }
  const small = matrix(n, n, host);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { host.tick(); small[i]![j] = r[i]![j]!; }
  return { r: small, v };
}
function qtColumn(qr: QR, column: number, host: FunctionHost): Quad[] {
  const x = matrix(1, qr.v.length, host)[0]!; x[column] = [1, 0];
  for (let k = 0; k < qr.r.length; k++) {
    let retained: Quad = [0, 0];
    for (let i = k; i < x.length; i++) { host.tick(); retained = add(retained, multiply(x[i]!, qr.v[i]![k]!)); }
    retained = add(retained, retained);
    for (let i = k; i < x.length; i++) { host.tick(); x[i] = subtract(x[i]!, multiply(retained, qr.v[i]![k]!)); }
  }
  return x;
}
function inverse(a: QuadMatrix, threshold: number, host: FunctionHost): QuadMatrix | undefined {
  const qr = factor(a, host), n = a.length; let minimum = Infinity, maximum = 0;
  for (let i = 0; i < n; i++) { host.tick(); const value = Math.abs(qr.r[i]![i]![0]); minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  if (!(minimum > maximum * threshold)) return undefined;
  const result = matrix(n, n, host);
  for (let column = 0; column < n; column++) {
    const x = qtColumn(qr, column, host);
    for (let i = n - 1; i >= 0; i--) {
      let retained = x[i]!;
      for (let j = i + 1; j < n; j++) { host.tick(); retained = subtract(retained, multiply(qr.r[i]![j]!, x[j]!)); }
      x[i] = divide(retained, qr.r[i]![i]!); result[i]![column] = x[i]!;
    }
  }
  return result;
}
/** QR diagonal truncation and the same ten regularized Newton steps as GOffice. */
function pseudoInverse(a: QuadMatrix, threshold: number, host: FunctionHost): QuadMatrix {
  const m = a.length, n = a[0]!.length;
  if (m < n) return transpose(pseudoInverse(transpose(a, host), threshold, host), host);
  const qr = factor(a, host), result = matrix(n, m, host); let maximum = 0, fullRank = true;
  for (let i = 0; i < n; i++) { host.tick(); maximum = Math.max(maximum, Math.abs(qr.r[i]![i]![0])); }
  if (maximum === 0) return result;
  for (let i = 0; i < n; i++) {
    host.tick(); if (Math.abs(qr.r[i]![i]![0]) <= maximum * threshold) { fullRank = false; qr.r[i]![i] = [0, 0]; }
  }
  const rt = transpose(qr.r, host), gram = matrixProduct(rt, qr.r, host);
  for (let i = 0; i < n; i++) { host.tick(); gram[i]![i] = add(gram[i]![i]!, [fullRank ? 0 : maximum * threshold, 0]); }
  const initial = inverse(gram, 0, host);
  if (!initial) return result;
  let retained = matrixProduct(initial, rt, host);
  for (let step = 0; step < 10; step++) {
    const w = matrixProduct(retained, qr.r, host);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { host.tick(); w[i]![j] = subtract([i === j ? 2 : 0, 0], w[i]![j]!); }
    retained = matrixProduct(w, retained, host);
  }
  for (let j = 0; j < m; j++) {
    const x = qtColumn(qr, j, host);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) { host.tick(); result[i]![j] = add(result[i]![j]!, multiply(retained[i]![k]!, x[k]!)); }
  }
  return result;
}
export function qrInverse(a: number[][], threshold: number, pseudo: boolean, host: FunctionHost): number[][] | undefined {
  if (threshold < 0 || !Number.isFinite(threshold)) return undefined;
  const input = matrix(a.length, a[0]!.length, host);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < a[0]!.length; j++) { host.tick(); input[i]![j] = [a[i]![j]!, 0]; }
  const result = pseudo ? pseudoInverse(input, threshold, host) : inverse(input, threshold, host);
  if (!result) return undefined;
  return result.map(row => row.map(cell => cell[0] + cell[1]));
}

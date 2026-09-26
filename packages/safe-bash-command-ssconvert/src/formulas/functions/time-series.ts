// SPDX-License-Identifier: GPL-2.0-or-later
import { SsconvertError } from '../../contracts.js';
import { error, numericResult, rendered } from '../values.js';
import { admitMatrix, collect, numberArg } from './common.js';
import { statisticalNumbers, statisticalPairs } from './statistics-range.js';
import type { FunctionHost, FunctionImplementation, Value } from './types.js';
import type { CellValue } from '../../workbook.js';
function vector(value: Value, host: FunctionHost): number[] | CellValue {
  const matrix = host.matrix(value);
  if (matrix.rows.length !== 1 && matrix.rows[0]?.length !== 1) return error('#VALUE!');
  return statisticalNumbers(value,host);
}
function paddedLength(n: number, columns: number, host: FunctionHost): number {
  let length = 1; while (length < n) { host.tick(); length *= 2; }
  if (length * columns > host.context.limits.cells) throw new SsconvertError('resource-limit','ssconvert calculation array limit exceeded');
  return length;
}
type Pair = readonly [number,number];
function fft(xs: readonly number[], length: number, inverse: boolean, host: FunctionHost): Pair[] {
  const transform = (offset: number, stride: number, n: number): Pair[] => {
    host.tick(); if (n === 1) return [[xs[offset] ?? 0,0]];
    const half = n / 2, even = transform(offset,stride * 2,half), odd = transform(offset + stride,stride * 2,half), output: Pair[] = [];
    const step = (inverse ? Math.PI : -Math.PI) / half;
    for (let i = 0; i < half; i++) { host.tick(); const angle = step * i, re = odd[i]![0] * Math.cos(angle) - odd[i]![1] * Math.sin(angle), im = odd[i]![0] * Math.sin(angle) + odd[i]![1] * Math.cos(angle); output[i] = [(even[i]![0] + re) * .5,(even[i]![1] + im) * .5]; output[i + half] = [(even[i]![0] - re) * .5,(even[i]![1] - im) * .5]; }
    return output;
  };
  return transform(0,1,length);
}
function interpolationCoefficients(xs: readonly number[], ys: readonly number[], method: number, host: FunctionHost): number[][] | undefined {
  const n = xs.length; if (n < (method === 2 ? 1 : 2) || xs.some((x,i) => i > 0 && x <= xs[i - 1]!)) return undefined;
  const second = Array.from({length:n},() => 0), work = [...second];
  if (method === 4) {
    if (n < 3) return undefined;
    for (let i = 1; i < n - 1; i++) { host.tick(); const ratio = (xs[i]! - xs[i - 1]!) / (xs[i + 1]! - xs[i - 1]!), denominator = ratio * second[i - 1]! + 2; second[i] = (ratio - 1) / denominator; work[i] = (6 * ((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!) - (ys[i]! - ys[i - 1]!) / (xs[i]! - xs[i - 1]!)) / (xs[i + 1]! - xs[i - 1]!) - ratio * work[i - 1]!) / denominator; }
    for (let i = n - 2; i >= 0; i--) { host.tick(); second[i] = second[i]! * second[i + 1]! + work[i]!; }
  }
  return xs.slice(0,n - 1).map((x,i) => { host.tick(); const width = xs[i + 1]! - x; return [ys[i]!,method === 2 ? 0 : (ys[i + 1]! - ys[i]!) / width - width * (2 * second[i]! + second[i + 1]!) / 6,second[i]! / 2,(second[i + 1]! - second[i]!) / (6 * width)]; });
}
function interpolate(xs: readonly number[], ys: readonly number[], targets: readonly number[], method: number, host: FunctionHost): number[] | undefined {
  const base = method - method % 2, coefficients = interpolationCoefficients(xs,ys,base,host); if (!coefficients) return undefined;
  const interval = (x: number) => { let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { host.tick(); const mid = Math.floor((lo + hi) / 2); if (x < xs[mid]!) hi = mid; else lo = mid; } return lo; };
  const value = (x: number) => { const i = interval(x); if (base === 2) return x >= xs[xs.length - 1]! ? ys[ys.length - 1]! : ys[i]!; const c = coefficients[i]!, t = x - xs[i]!; return c[0]! + t * (c[1]! + t * (c[2]! + t * c[3]!)); };
  if (method % 2 === 0) return targets.map(value);
  if (targets.length < 2 || targets.some((x,i) => i > 0 && x <= targets[i - 1]!)) return undefined;
  const primitive = (i: number, x: number) => { const c = coefficients[i]!, t = x - xs[i]!; return t * (c[0]! + t * (c[1]! / 2 + t * (c[2]! / 3 + t * c[3]! / 4))); };
  return targets.slice(0,-1).map((lo,k) => { const hi = targets[k + 1]!; let left = lo, total = 0; while (left < hi) { host.tick(); const i = interval(left), right = Math.min(hi, xs[i + 1]! > left ? xs[i + 1]! : hi); total += base === 2 ? value(left) * (right - left) : primitive(i,right) - primitive(i,left); left = right; } return total / (hi - lo); });
}
function hpFilter(raw: readonly number[], lambda: number, host: FunctionHost): number[] | CellValue {
  const n = raw.length, a = Array.from({length:n},() => 6 * lambda + 1), b = Array.from({length:n},() => -4 * lambda), c = Array.from({length:n},() => lambda), h = [0,0,0,0,0], g = [0,0,0,0,0];
  a[0] = lambda + 1; b[0] = -2 * lambda; a[n - 2] = a[1] = 5 * lambda + 1; a[n - 1] = a[0]; b[n - 2] = b[0]; b[n - 1] = 0; c[n - 2] = c[n - 1] = 0;
  for (let i = 0; i < n; i++) { host.tick(); const denominator = a[i]! - h[3]! * h[0]! - g[4]! * g[1]!; if (denominator === 0) return error('#DIV/0!'); const hb = b[i]!, hc = c[i]!; g[0] = h[0]!; b[i] = h[0] = (hb - h[3]! * h[1]!) / denominator; g[1] = h[1]!; c[i] = h[1] = hc / denominator; a[i] = (raw[i]! - g[2]! * g[4]! - h[2]! * h[3]!) / denominator; g[2] = h[2]!; h[2] = a[i]!; h[3] = hb - h[4]! * g[0]!; g[4] = h[4]!; h[4] = hc; }
  const output = [...raw]; let previous = a[n - 1]!, second = 0; output[n - 1] = previous;
  for (let i = n - 1; i > 0; i--) { host.tick(); output[i - 1] = a[i - 1]! - b[i - 1]! * previous - c[i - 1]! * second; second = previous; previous = output[i - 1]!; }
  return output;
}
export const timeSeriesFunctions: Readonly<Record<string, FunctionImplementation>> = {
  FOURIER:(a,h) => { const xs = vector(a[0]!,h); if (!Array.isArray(xs)) return xs; if (!xs.length) return error('#VALUE!'); const separate = numberArg(a,2,h) !== 0, length = paddedLength(xs.length,separate ? 2 : 1,h), output = fft(xs,length,numberArg(a,1,h) !== 0,h); return admitMatrix(output.map(([re,im]) => separate ? [numericResult(re),numericResult(im)] : [{kind:'string',value:im === 0 ? rendered(numericResult(re)) : `${re === 0 ? '' : rendered(numericResult(re))}${im < 0 || re === 0 ? '' : '+'}${im === 1 ? '' : im === -1 ? '-' : rendered(numericResult(im))}i`}]),h); },
  HPFILTER:(a,h) => { const xs = vector(a[0]!,h); if (!Array.isArray(xs)) return xs; if (xs.length < 6) return error('#VALUE!'); const filtered = hpFilter(xs,numberArg(a,1,h,1600),h); return Array.isArray(filtered) ? admitMatrix(filtered.map((x,i) => [numericResult(x),numericResult(xs[i]! - x)]),h) : filtered; },
  INTERPOLATION:(a,h) => { const targets = h.matrix(a[2]!); if (targets.rows[0]?.length !== 1) return error('#VALUE!'); const method = Math.floor(numberArg(a,3,h)); if (method < 0 || method > 5) return error('#VALUE!'); const pairs = statisticalPairs(a[0]!,a[1]!,h); if (!Array.isArray(pairs)) return pairs; const sorted = pairs[0].map((x,i) => [x,pairs[1][i]!] as const).sort((a,b) => { h.tick(); return a[0] - b[0]; }); for (let i = 1; i < sorted.length; i++) { h.tick(); if (sorted[i]![0] === sorted[i - 1]![0]) return error('#VALUE!'); } const ts = collect(a[2]!,h), numericTargets = ts.filter((x): x is Extract<CellValue,{kind:'number'}> => x.kind === 'number').map(x => x.value); const result = interpolate(sorted.map(p => p[0]),sorted.map(p => p[1]),numericTargets,method,h), length = targets.rows.length - method % 2; if (length <= 0) return error('#VALUE!'); let index = 0; return admitMatrix(ts.slice(0,length).map(x => [x.kind === 'number' && result && index < result.length ? numericResult(result[index++]!) : error('#VALUE!')]),h); },
  PERIODOGRAM:(a,h) => { let xs = vector(a[0]!,h); if (!Array.isArray(xs)) return xs; if (!xs.length) return error('#VALUE!'); const filter = Math.floor(numberArg(a,1,h)); if (filter < 0 || filter > 3) return error('#VALUE!'); let length = paddedLength(xs.length,1,h); if (a[2]) { const pairs = statisticalPairs(a[2],a[0]!,h); if (!Array.isArray(pairs)) return pairs; const [absc,ord] = pairs; if (absc.length !== 1) { const method = Math.floor(numberArg(a,3,h)); let count = Math.floor(numberArg(a,4,h,length)); if (count < absc.length || method < 0 || method > 5 || absc.length < 2) return error('#VALUE!'); length = paddedLength(count,1,h); if (a[4] === undefined) count = length; const increment = (absc[absc.length - 1]! - absc[0]!) / count, start = absc[0]! - (method % 2 ? increment / 2 : 0), interpolated = interpolate(absc,ord,Array.from({length:count + method % 2},(_,i) => { h.tick(); return start + i * increment; }),method,h); if (!interpolated) return error('#N/A'); xs = interpolated; } }
    const n = xs.length; xs = xs.map((x,i) => { h.tick(); const u = i / (n / 2) - 1; return filter === 1 ? x * (1 - Math.abs(u)) : filter === 2 ? x * .5 * (1 - Math.cos(2 * Math.PI * i / n)) : filter === 3 ? x * (1 - u * u) : x; }); const output = fft(xs,length,false,h); return length < 2 ? error('#VALUE!') : admitMatrix(output.slice(0,length / 2).map(([re,im]) => [numericResult(Math.sqrt(re * re + im * im))]),h);
  },
};

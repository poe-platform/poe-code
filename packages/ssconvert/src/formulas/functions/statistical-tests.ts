// SPDX-License-Identifier: GPL-2.0-or-later
import { error, numericResult, sum } from '../values.js';
import { admitMatrix, numberArg } from './common.js';
import { squaredDeviations } from './database.js';
import { statisticalMean, statisticalNumbers, statisticalPairs, statisticalSort } from './statistics-range.js';
import { normalProbability, normalQuantile } from './normal-distribution.js';
import { distributionValue } from './probability.js';
import type { CellValue } from '../../workbook.js';
import type { FunctionHost, FunctionImplementation, SpecialForm, Value } from './types.js';
function normality(name:string,value:Value,host:FunctionHost):Value {
  const xs = statisticalNumbers(value,host); if (!Array.isArray(xs)) return xs;
  const n = xs.length, minimum = name === 'SFTEST' || name === 'LKSTEST' ? 5 : 8;
  const invalid = () => admitMatrix([[error('#VALUE!')],[error('#VALUE!')],[numericResult(n)]],host);
  if (n < minimum || name === 'SFTEST' && n > 5000) return invalid();
  const mean = statisticalMean(xs,host), variance = squaredDeviations(xs,host) / (n - 1), sd = Math.sqrt(variance);
  statisticalSort(xs,host); let statistic = 0, probability = 0;
  if (name === 'SFTEST') {
    const zs = xs.map((_,i) => normalQuantile((i + 1 - 3 / 8) / (n + .25))), zm = statisticalMean(zs,host), zsq = squaredDeviations(zs,host);
    if (!variance || !zsq) return invalid();
    const xy = sum(xs.map((x,i) => (x - mean) * (zs[i]! - zm)),host.tick);
    statistic = xy * xy / (variance * (n - 1)) / zsq;
    const u = Math.log(n), v = Math.log(u), mu = -1.2725 + 1.0521 * (v - u), sigma = 1.0308 - .26758 * (v + 2 / u);
    probability = normalProbability((Math.log1p(-statistic) - mu) / sigma,false);
  } else if (name === 'LKSTEST') {
    for (let i = 0; i < n; i++) { host.tick(); const p = normalProbability((xs[i]! - mean) / sd); statistic = Math.max(statistic,(i + 1) / n - p,p - i / n); }
    let d = n > 100 ? statistic * (n / 100) ** .49 : statistic; const nd = Math.min(n,100);
    probability = Math.exp(-7.01256 * d * d * (nd + 2.78019) + 2.99587 * d * Math.sqrt(nd + 2.78019) - .122119 + .974598 / Math.sqrt(nd) + 1.67997 / nd);
    if (probability > .1) { d *= Math.sqrt(nd) - .01 + .85 / Math.sqrt(nd); probability = d <= .302 ? 1 : d <= .5 ? 2.76773 - 19.828315 * d + 80.709644 * d ** 2 - 138.55152 * d ** 3 + 81.218052 * d ** 4 : d <= .9 ? -4.901232 + 40.662806 * d - 97.490286 * d ** 2 + 94.029866 * d ** 3 - 32.355711 * d ** 4 : d <= 1.31 ? 6.198765 - 19.558097 * d + 23.186922 * d ** 2 - 12.234627 * d ** 3 + 2.423045 * d ** 4 : 0; }
  } else if (name === 'CVMTEST') {
    for (let i = 0; i < n; i++) { host.tick(); statistic += (normalProbability((xs[i]! - mean) / sd) - (2 * i + 1) / (2 * n)) ** 2; }
    statistic += 1 / (12 * n); const t = statistic * (1 + .5 / n);
    probability = t < .0275 ? 1 - Math.exp(-13.953 + 775.5 * t - 12542.61 * t * t) : t < .051 ? 1 - Math.exp(-5.903 + 179.546 * t - 1515.29 * t * t) : t < .092 ? Math.exp(.886 - 31.62 * t - 10.897 * t * t) : t < 1 ? Math.exp(1.111 - 34.242 * t + 12.832 * t * t) : 0;
  } else {
    for (let i = 0; i < n; i++) { host.tick(); statistic += (2 * i + 1) * (normalProbability((xs[i]! - mean) / sd,true,true) + normalProbability((xs[n - i - 1]! - mean) / sd,false,true)); }
    statistic = (-n - statistic / n) * (1 + .75 / n + 2.25 / (n * n)); const t = statistic;
    probability = t < .20 ? -Math.expm1(-13.436 + 101.14 * t - 223.73 * t * t) : t < .34 ? -Math.expm1(-8.318 + 42.796 * t - 59.938 * t * t) : t < .6 ? Math.exp(.9177 - 4.279 * t - 1.38 * t * t) : Math.exp(1.2937 - 5.709 * t + .0186 * t * t);
  }
  return admitMatrix([[numericResult(probability)],[numericResult(statistic)],[numericResult(n)]],host);
}
function sample(value:Value,host:FunctionHost): {xs:number[];mean:number;variance:number} | CellValue {
  const xs = statisticalNumbers(value,host); if (!Array.isArray(xs)) return xs;
  if (xs.length < 2) return error('#DIV/0!');
  return {xs,mean:statisticalMean(xs,host),variance:squaredDeviations(xs,host) / (xs.length - 1)};
}
export const statisticalTestFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ...Object.fromEntries(['ADTEST','CVMTEST','LKSTEST','SFTEST'].map(name => [name,(a,h) => normality(name,a[0]!,h)])),
  ZTEST:(a,h) => { const xs = statisticalNumbers(a[0]!,h); if (!Array.isArray(xs)) return xs; if (!xs.length) return error('#DIV/0!'); const sd = numberArg(a,2,h,Math.sqrt(squaredDeviations(xs,h) / (xs.length - 1))); return numericResult(normalProbability((statisticalMean(xs,h) - numberArg(a,1,h)) * Math.sqrt(xs.length) / sd,false)); },
  FTEST:(a,h) => { const x = sample(a[0]!,h), y = sample(a[1]!,h); if ('kind' in x) return x; if ('kind' in y) return y; if (!x.variance || !y.variance) return error('#DIV/0!'); const ratio = x.variance / y.variance, degrees = [x.xs.length - 1,y.xs.length - 1], lower = distributionValue('f','p',ratio,degrees,true,false,h), upper = distributionValue('f','p',ratio,degrees,false,false,h); return numericResult(2 * Math.min(lower,upper)); },
  TTEST:(a,h) => { const tails = numberArg(a,2,h), type = numberArg(a,3,h); if (tails !== 1 && tails !== 2 || ![1,2,3].includes(type)) return error('#NUM!'); let t:number, df:number;
    if (type === 1) { const pairs = statisticalPairs(a[0]!,a[1]!,h); if (!Array.isArray(pairs)) return pairs; const differences = pairs[0].map((x,i) => x - pairs[1][i]!), n = differences.length, sd = Math.sqrt(squaredDeviations(differences,h) / (n - 1)); if (n < 2 || sd === 0) return error('#DIV/0!'); t = Math.sqrt(n) * Math.abs(statisticalMean(differences,h)) / sd; df = n - 1; }
    else { const x = sample(a[0]!,h), y = sample(a[1]!,h); if ('kind' in x) return x; if ('kind' in y) return y; const nx = x.xs.length, ny = y.xs.length; if (!x.variance && !y.variance) return error('#DIV/0!'); if (type === 3) { const s = x.variance / nx + y.variance / ny, c = x.variance / nx / s, cc = y.variance / ny / s; df = 1 / (c * c / (nx - 1) + cc * cc / (ny - 1)); t = Math.abs(x.mean - y.mean) / Math.sqrt(s); } else { df = nx + ny - 2; t = Math.abs(x.mean - y.mean) * Math.sqrt(df * nx * ny / ((nx + ny) * ((nx - 1) * x.variance + (ny - 1) * y.variance))); } }
    return numericResult(tails * distributionValue('t','p',t,[df],false,false,h)); },
  CHITEST:(a,h) => { const x = h.matrix(a[0]!), y = h.matrix(a[1]!); const rows = x.rows.length, columns = x.rows[0]?.length ?? 0; if (rows !== y.rows.length || columns !== y.rows[0]?.length) return error('#N/A'); let statistic = 0; for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) { h.tick(); const observed = x.rows[r]![c]!, expected = y.rows[r]![c]!; if (observed.kind === 'error') return observed; if (expected.kind === 'error') return expected; if (observed.kind !== 'number' || expected.kind !== 'number') continue; if (expected.value === 0) return error('#DIV/0!'); if (expected.value < 0) return error('#NUM!'); statistic += (observed.value - expected.value) ** 2 / expected.value; } const df = rows === 1 || columns === 1 ? rows * columns - 1 : (rows - 1) * (columns - 1); return df < 1 ? error('#NUM!') : numericResult(distributionValue('gamma','p',statistic,[df / 2,2],false,false,h)); },
};
export const cronbach: SpecialForm = (nodes,h) => {
  if (nodes.length < 2) return error('#VALUE!'); const columns:number[][] = [];
  for (const node of nodes) { const xs = statisticalNumbers(h.evaluate(node,true),h); if (!Array.isArray(xs)) return xs; if (xs.length < 2) return error('#DIV/0!'); if (columns.length && columns[0]!.length !== xs.length) return error('#N/A'); columns.push(xs); }
  const totals = columns[0]!.map((_,i) => sum(columns.map(xs => xs[i]!),h.tick)), totalVariance = squaredDeviations(totals,h), varianceSum = sum(columns.map(xs => squaredDeviations(xs,h)),h.tick), k = columns.length;
  return totalVariance === 0 ? error('#DIV/0!') : numericResult(k / (k - 1) * (1 - varianceSum / totalVariance));
};

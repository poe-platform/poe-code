// SPDX-License-Identifier: GPL-2.0-or-later
import { error, numeric, numericResult, product, sum } from "../values.js";
import { admitMatrix, collect, numberArg } from "./common.js";
import { squaredDeviations } from "./database.js";
import { fakeFloor, fakeTrunc } from "./floating-point.js";
import { statisticalMean, statisticalNumbers, statisticalPairs, statisticalSort, quantile } from "./statistics-range.js";
import type { FunctionHost, FunctionImplementation, SpecialForm, Value } from "./types.js";
import { SsconvertError } from '../../contracts.js';
import { parseExpression } from '../parser.js';
import type { FormulaNode } from '../ast.js';
import type { CellValue } from '../../workbook.js';

const aggregates = ['AVEDEV', 'AVERAGE', 'AVERAGEA', 'COUNT', 'COUNTA', 'DEVSQ', 'GEOMEAN', 'HARMEAN', 'KURT', 'KURTP', 'MAX', 'MAXA', 'MEDIAN', 'MIN', 'MINA', 'MODE', 'MODE.MULT', 'SKEW', 'SKEWP', 'STDEV', 'STDEVA', 'STDEVP', 'STDEVPA', 'VAR', 'VARA', 'VARP', 'VARPA'];
export function statisticalAggregate(name: string, values: readonly Value[], host: FunctionHost): Value {
  const xs: number[] = [], includeText = ['AVERAGEA','COUNTA','MAXA','MINA','STDEVA','STDEVPA','VARA','VARPA'].includes(name);
  for (const value of values) {
    if (name === 'COUNTA') { for (const cell of collect(value,host)) { if (cell.kind === 'blank') continue; if (xs.length >= host.context.limits.cells) throw new SsconvertError('resource-limit','ssconvert calculation array limit exceeded'); xs.push(0); } continue; }
    const numbers = statisticalNumbers(value, host, includeText, name === 'COUNT');
    if (!Array.isArray(numbers)) return numbers;
    if (numbers.length > host.context.limits.cells - xs.length) throw new SsconvertError('resource-limit','ssconvert calculation array limit exceeded');
    for (const number of numbers) { host.tick(); xs.push(number); }
  }
  const n = xs.length;
  if (name === 'COUNT' || name === 'COUNTA') return numericResult(n);
  if (['MAX','MAXA','MIN','MINA'].includes(name)) return numericResult(n ? xs.reduce((a,b) => name.startsWith('MAX') ? Math.max(a,b) : Math.min(a,b)) : 0);
  if (!n) return error(['MEDIAN','MODE','MODE.MULT'].includes(name) ? '#N/A' : '#DIV/0!');
  const mean = statisticalMean(xs, host);
  if (name === 'AVERAGE' || name === 'AVERAGEA') return numericResult(mean);
  if (name === 'GEOMEAN') return xs.some(x => x <= 0) ? error('#NUM!') : numericResult(Math.exp(statisticalMean(xs.map(Math.log), host)));
  if (name === 'HARMEAN') return xs.some(x => x <= 0) ? error('#NUM!') : numericResult(n / sum(xs.map(x => 1 / x), host.tick));
  if (name === 'AVEDEV') return numericResult(statisticalMean(xs.map(x => Math.abs(x - mean)), host));
  if (name === 'MEDIAN') return numericResult(quantile(statisticalSort(xs, host), .5, false));
  if (name.startsWith('MODE')) {
    const counts = new Map<number, number>(); let maximum = 1;
    for (const x of xs) { host.tick(); const count = (counts.get(x) ?? 0) + 1; counts.set(x,count); maximum = Math.max(maximum,count); }
    const modes = [...counts].filter(([, count]) => count === maximum).map(([value]) => value);
    if (maximum === 1) return error('#N/A');
    return name === 'MODE' ? numericResult(modes[0]!) : admitMatrix(modes.map(x => [numericResult(x)]), host);
  }
  const devsq = xs.every(x => x === xs[0]) ? 0 : squaredDeviations(xs, host);
  if (name === 'DEVSQ') return numericResult(devsq);
  if (name.startsWith('VAR') || name.startsWith('STDEV')) {
    const population = name.includes('P'); if (n < (population ? 1 : 2)) return error('#DIV/0!');
    const variance = devsq / (population ? n : n - 1);
    return numericResult(name.startsWith('VAR') ? variance : Math.sqrt(variance));
  }
  const population = name.endsWith('P'), kurtosis = name.startsWith('KURT'), required = population ? 1 : kurtosis ? 4 : 3;
  if (n < required || devsq === 0) return error('#DIV/0!');
  const sd = Math.sqrt(devsq / (population ? n : n - 1));
  const moment = sum(xs.map(x => ((x - mean) / sd) ** (kurtosis ? 4 : 3)), host.tick);
  return numericResult(kurtosis ? population ? moment / n - 3 : n * (n + 1) * moment / ((n - 1) * (n - 2) * (n - 3)) - 3 * (n - 1) ** 2 / ((n - 2) * (n - 3)) : population ? moment / n : n * moment / ((n - 1) * (n - 2)));
}
export const statisticsSpecialForms: Readonly<Record<string, SpecialForm>> = Object.fromEntries(aggregates.map(name => [name, (nodes, host) => statisticalAggregate(name, nodes.map(node => host.evaluate(node, true)), host)]));

function orderStatistic(name: string, args: readonly (Value | undefined)[], host: FunctionHost): Value {
  const rank = name === 'RANK' || name === 'RANK.AVG';
  const xs = statisticalNumbers(args[rank ? 1 : 0]!, host); if (!Array.isArray(xs)) return xs;
  statisticalSort(xs, host); const n = xs.length, x = numberArg(args, rank ? 0 : 1, host);
  if (rank) {
    const ascending = numberArg(args, 2, host) !== 0, below = xs.filter(y => ascending ? y < x : y > x).length, ties = xs.filter(y => y === x).length;
    return numericResult(1 + below + (name === 'RANK.AVG' && ties > 1 ? (ties - 1) / 2 : 0));
  }
  if (name === 'LARGE' || name === 'SMALL') {
    const k = Math.ceil(x); return k < 1 || k > n ? error('#NUM!') : numericResult(xs[name === 'SMALL' ? k - 1 : n - k]!);
  }
  if (name.startsWith('QUARTILE') || name.startsWith('PERCENTILE')) return numericResult(quantile(xs, name.startsWith('QUARTILE') ? fakeFloor(x) / 4 : x, name.endsWith('.EXC')));
  if (name === 'SSMEDIAN') {
    const interval = numberArg(args, 1, host, 1); if (interval <= 0 || !n) return error('#NUM!');
    const mid = quantile(xs,.5,false); if (n <= 2 || n % 2 === 0 && xs[n / 2] !== xs[n / 2 - 1]) return numericResult(mid);
    const lower = mid - interval / 2, upper = mid + interval / 2;
    return numericResult(lower + (n / 2 - xs.filter(x => x < lower).length) * interval / xs.filter(x => x >= lower && x <= upper).length);
  }
  if (name === 'TRIMMEAN') {
    if (!n || x < 0 || x >= 1) return error('#NUM!');
    const trim = Math.floor(n * x / 2); return numericResult(statisticalMean(xs.slice(trim, n - trim), host));
  }
  if (!n) return error('#NUM!'); if (x < xs[0]! || x > xs[n - 1]!) return error('#N/A');
  if (n === 1) return numericResult(1);
  const significance = numberArg(args, 2, host, 3); if (significance < 1) return error('#NUM!');
  const unit = 10 ** -significance; if (!unit) return error('#DIV/0!');
  const smaller = xs.filter(y => y < x).length, equal = xs.filter(y => y === x).length, exclusive = name.endsWith('.EXC');
  let r = smaller + (exclusive ? 1 : 0);
  if (!equal) r = smaller - (exclusive ? 0 : 1) + (x - xs[smaller - 1]!) / (xs[smaller]! - xs[smaller - 1]!);
  return numericResult(fakeTrunc(r / (exclusive ? n + 1 : n - 1) / unit) * unit);
}
function pairedStatistic(name: string, args: readonly (Value | undefined)[], host: FunctionHost): Value {
  const forecast = name === 'FORECAST', pairs = statisticalPairs(args[forecast ? 1 : 0]!, args[forecast ? 2 : 1]!, host);
  if (!Array.isArray(pairs)) return pairs;
  const [ys,xs] = pairs, n = xs.length;
  if (!n || name === 'COVARIANCE.S' && n < 2) return error('#DIV/0!');
  const xm = statisticalMean(xs,host), ym = statisticalMean(ys,host);
  const xx = squaredDeviations(xs,host), yy = squaredDeviations(ys,host), xy = sum(xs.map((x,i) => (x - xm) * (ys[i]! - ym)),host.tick);
  if (name === 'COVAR' || name === 'COVARIANCE.S') return numericResult(xy / (name === 'COVAR' ? n : n - 1));
  if (xx === 0 || ['CORREL','PEARSON','RSQ'].includes(name) && yy === 0) return error('#DIV/0!');
  const slope = xy / xx, intercept = ym - slope * xm;
  return numericResult(name === 'SLOPE' ? slope : name === 'INTERCEPT' ? intercept : forecast ? intercept + slope * numberArg(args,0,host) : name === 'STEYX' ? n < 3 ? NaN : Math.sqrt(Math.max(0, yy - xy * slope) / (n - 2)) : name === 'RSQ' ? xy * xy / xx / yy : xy / Math.sqrt(xx) / Math.sqrt(yy));
}
export const statisticsFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ...Object.fromEntries(['LARGE','SMALL','PERCENTILE','PERCENTILE.EXC','QUARTILE','QUARTILE.EXC','PERCENTRANK','PERCENTRANK.EXC','RANK','RANK.AVG','SSMEDIAN','TRIMMEAN'].map(name => [name, (args,host) => orderStatistic(name,args,host)])),
  ...Object.fromEntries(['CORREL','PEARSON','COVAR','COVARIANCE.S','SLOPE','INTERCEPT','FORECAST','STEYX','RSQ'].map(name => [name, (args,host) => pairedStatistic(name,args,host)])),
  STANDARDIZE: (a,h) => { const sd = numberArg(a,2,h); return sd <= 0 ? error('#NUM!') : numericResult((numberArg(a,0,h) - numberArg(a,1,h)) / sd); },
  FISHER: (a,h) => { const x = numberArg(a,0,h); return Math.abs(x) >= 1 ? error('#NUM!') : numericResult(Math.atanh(x)); },
  FISHERINV: (a,h) => numericResult(Math.tanh(numberArg(a,0,h))),
  PERMUTATIONA: (a,h) => { const n = fakeFloor(numberArg(a,0,h)), k = fakeFloor(numberArg(a,1,h)); return n < 0 || k < 0 ? error('#NUM!') : numericResult(k === 0 ? 1 : n ** k); },
  PERMUT: (a,h) => { const n = fakeFloor(numberArg(a,0,h)), k = fakeFloor(numberArg(a,1,h)); if (n < 0 || k < 0 || k > n) return error('#NUM!'); let result = 1; for (let i = 0; i < k; i++) { h.tick(); result *= n - i; if (!Number.isFinite(result)) break; } return numericResult(result); },
  FREQUENCY: (a,h) => { const xs = statisticalNumbers(a[0]!,h), bins = statisticalNumbers(a[1]!,h); if (!Array.isArray(xs)) return xs; if (!Array.isArray(bins)) return bins; statisticalSort(bins,h); const counts = Array.from({length:bins.length + 1}, () => 0); for (const x of xs) { h.tick(); const i = bins.findIndex(b => x <= b); counts[i < 0 ? bins.length : i]!++; } return admitMatrix(counts.map(n => [numericResult(n)]),h); },
  PROB: (a,h) => { const pairs = statisticalPairs(a[0]!,a[1]!,h); if (!Array.isArray(pairs)) return pairs; const [xs,ps] = pairs; if (!xs.length || ps.some(p => p < 0 || p > 1) || Math.abs(sum(ps,h.tick) - 1) > 1e-7) return error('#NUM!'); const lo = numberArg(a,2,h), hi = numberArg(a,3,h,lo); return numericResult(sum(ps.filter((_,i) => xs[i]! >= lo && xs[i]! <= hi),h.tick)); },
};
export const subtotalSpecialForm: SpecialForm = (nodes, host) => {
  if (!nodes.length) return error('#NUM!'); const code = host.scalar(host.evaluate(nodes[0]!));
  if (code.kind === 'error') return code;
  const number = numeric(code); if (number === undefined) return error('#VALUE!');
  const k = Math.trunc(number), name = ['AVERAGE','COUNT','COUNTA','MAX','MIN','PRODUCT','STDEV','STDEVP','SUM','VAR','VARP'][(k > 100 ? k - 100 : k) - 1];
  if (!name) return error('#VALUE!');
  const cells: CellValue[] = [];
  const containsSubtotal = (node: FormulaNode): boolean => {
    host.tick();
    if (node.kind === 'call') return node.name === 'SUBTOTAL' || node.args.some(containsSubtotal);
    if (node.kind === 'binary') return containsSubtotal(node.left) || containsSubtotal(node.right);
    if (node.kind === 'unary' || node.kind === 'parentheses') return containsSubtotal(node.child);
    if (node.kind === 'array') return node.rows.some(row => row.some(containsSubtotal));
    return false;
  };
  const append = (cell: CellValue) => { if (cells.length >= host.context.limits.cells) throw new SsconvertError('resource-limit','ssconvert calculation array limit exceeded'); cells.push(cell); };
  const visit = (value: Value): void => {
    if (value.kind === 'set') { for (const child of value.values) visit(child); return; }
    if (value.kind !== 'range') { for (const cell of collect(value,host)) append(cell); return; }
    const area = value.sheets.length * (value.lastRow - value.firstRow + 1) * (value.lastColumn - value.firstColumn + 1);
    if (area > host.context.limits.cells) throw new SsconvertError('resource-limit','ssconvert calculation range limit exceeded');
    for (const sheet of value.sheets) for (let row = value.firstRow; row <= value.lastRow; row++) {
      host.tick();
      if (k > 100 && sheet.rows?.some(metadata => { host.tick(); return metadata.index === row && metadata.hidden; })) continue;
      for (let column = value.firstColumn; column <= value.lastColumn; column++) {
        host.tick(); const cell = host.cell(sheet,row,column);
        if (cell?.formula) {
          const parsed = parseExpression(cell.formula,{position:{sheet:sheet.id,row,column},workbook:host.book,signal:host.context.signal,maximumLength:host.context.limits.inputBytes,maximumNodes:host.context.limits.workbookWork ?? host.context.limits.cells * 32 + host.context.limits.inputBytes});
          if (parsed.ok && containsSubtotal(parsed.document.root)) continue;
        }
        append(host.read(sheet,row,column));
      }
    }
  };
  for (const node of nodes.slice(1)) visit(host.evaluate(node,true));
  const values: Value[] = [{kind:'matrix',rows:cells.map(cell => [cell])}];
  if (name !== 'PRODUCT' && name !== 'SUM') return statisticalAggregate(name,values,host);
  const xs = statisticalNumbers(values[0]!,host); if (!Array.isArray(xs)) return xs;
  return numericResult(name === 'SUM' ? sum(xs,host.tick) : product(xs));
};

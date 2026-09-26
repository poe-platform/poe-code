// SPDX-License-Identifier: GPL-2.0-or-later
import { SsconvertError } from '../../contracts.js';
import { error, numericResult, sum } from '../values.js';
import { admitMatrix, collect, numberArg } from './common.js';
import { statisticalMean, statisticalNumbers } from './statistics-range.js';
import { squaredDeviations } from './database.js';
import { qrInverse } from './matrix-qr.js';
import type { CellValue } from '../../workbook.js';
import type { FunctionHost, FunctionImplementation, Value } from './types.js';
interface Model { readonly coefficients:number[]; readonly errors:number[]; readonly residual:number; readonly regression:number; readonly total:number; readonly df:number; readonly dimensions:number; }
function fit(ys:readonly number[], predictors:readonly (readonly number[])[], affine:boolean,host:FunctionHost):Model | undefined {
  const n = ys.length, dim = predictors[0]?.length ?? 0, p = dim + Number(affine); if (!n || !p || n < p || n * p > host.context.limits.cells) return undefined;
  const r = predictors.map(row => affine ? [1,...row] : [...row]), qy = [...ys];
  for (let k = 0; k < p; k++) {
    host.tick(); const norm = Math.hypot(...r.slice(k).map(row => row[k]!)); if (!norm) return undefined;
    const sign = r[k]![k]! < 0 ? -norm : norm, v = r.slice(k).map(row => row[k]!); v[0] = v[0]! + sign;
    const divisor = sum(v.map(x => x * x),host.tick); if (!divisor || !Number.isFinite(divisor)) return undefined;
    for (let j = k; j < p; j++) { const scale = 2 * sum(v.map((x,i) => x * r[k + i]![j]!),host.tick) / divisor; for (let i = 0; i < v.length; i++) { host.tick(); r[k + i]![j] = r[k + i]![j]! - scale * v[i]!; } }
    const scale = 2 * sum(v.map((x,i) => x * qy[k + i]!),host.tick) / divisor;
    for (let i = 0; i < v.length; i++) { host.tick(); qy[k + i] = qy[k + i]! - scale * v[i]!; }
  }
  const coefficients = Array.from({length:p},() => 0);
  for (let i = p - 1; i >= 0; i--) { host.tick(); if (Math.abs(r[i]![i]!) < Number.EPSILON * Math.abs(r[0]![0]!)) return undefined; coefficients[i] = (qy[i]! - sum(coefficients.slice(i + 1).map((x,j) => x * r[i]![i + 1 + j]!),host.tick)) / r[i]![i]!; }
  const residual = sum(ys.map((y,i) => (y - sum((affine ? [1,...predictors[i]!] : predictors[i]!).map((x,j) => x * coefficients[j]!),host.tick)) ** 2),host.tick), total = affine ? squaredDeviations(ys,host) : sum(ys.map(y => y * y),host.tick), regression = Math.max(0,total - residual), df = n - p;
  const inverseR = Array.from({length:p},() => Array.from({length:p},() => 0));
  if (p * p > host.context.limits.cells) throw new SsconvertError('resource-limit','ssconvert calculation array limit exceeded');
  for (let column = 0; column < p; column++) for (let i = p - 1; i >= 0; i--) { host.tick(); inverseR[i]![column] = ((i === column ? 1 : 0) - sum(inverseR.slice(i + 1).map((row,j) => r[i]![i + j + 1]! * row[column]!),host.tick)) / r[i]![i]!; }
  const errors = inverseR.map(row => Math.sqrt(sum(row.map(x => x * x),host.tick) * residual / df));
  return {coefficients:affine ? coefficients : [0,...coefficients],errors:affine ? errors : [NaN,...errors],residual,regression,total,df,dimensions:dim};
}
function regression(name:string,args:readonly (Value | undefined)[],host:FunctionHost):Value {
  const yMatrix = host.matrix(args[0]!), yCells = collect(args[0]!,host); if (!yCells.length || yCells.some(c => c.kind !== 'number')) return error('#VALUE!');
  let ys = yCells.map(c => c.kind === 'number' ? c.value : NaN);
  const xMatrix = args[1] ? host.matrix(args[1]) : {kind:'matrix' as const,rows:ys.map((_,i) => [numericResult(i + 1)])};
  let xs:number[][]; const vertical = !!args[1] && (yMatrix.rows[0]?.length ?? 0) === 1, horizontal = !!args[1] && yMatrix.rows.length === 1 && !vertical;
  if (!args[1]) xs = ys.map((_,i) => [i + 1]);
  else if (vertical) { if (xMatrix.rows.length !== yMatrix.rows.length) return error('#REF!'); xs = xMatrix.rows.map(row => row.map(c => c.kind === 'number' ? c.value : NaN)); }
  else if (horizontal) { if (xMatrix.rows[0]?.length !== yMatrix.rows[0]?.length) return error('#REF!'); xs = yCells.map((_,i) => xMatrix.rows.map(row => row[i]?.kind === 'number' ? (row[i] as Extract<CellValue,{kind:'number'}>).value : NaN)); }
  else { if (xMatrix.rows.length !== yMatrix.rows.length || xMatrix.rows[0]?.length !== yMatrix.rows[0]?.length) return error('#REF!'); xs = collect(xMatrix,host).map(c => [c.kind === 'number' ? c.value : NaN]); }
  if (xs.some(row => row.some(Number.isNaN))) return error('#VALUE!');
  const exponential = name === 'LOGEST' || name === 'GROWTH', predict = name === 'TREND' || name === 'GROWTH';
  if (exponential) { if (ys.some(y => y <= 0)) return error('#NUM!'); ys = ys.map(Math.log); }
  if (name === 'LOGREG') { if (xs.some(row => row.some(x => x <= 0))) return error('#NUM!'); xs = xs.map(row => row.map(Math.log)); }
  const affine = numberArg(args,predict ? 3 : 2,host,1) !== 0, model = fit(ys,xs,affine,host); if (!model) return error('#NUM!');
  const p = model.dimensions;
  if (predict) {
    const targets = args[2] ? host.matrix(args[2]) : xMatrix;
    const at = (row:readonly CellValue[]) => { if (row.some(c => c.kind !== 'number')) return error('#N/A'); const y = model.coefficients[0]! + sum(row.map((c,j) => (c.kind === 'number' ? c.value : NaN) * model.coefficients[j + 1]!),host.tick); return numericResult(exponential ? Math.exp(y) : y); };
    if (name === 'GROWTH' || !vertical && !horizontal) { if (p !== 1) return error('#NUM!'); return admitMatrix(collect(targets,host).map(c => [at([c])]),host); }
    if (vertical) { if (targets.rows[0]?.length !== p) return error('#NUM!'); return admitMatrix(targets.rows.map(row => [at(row)]),host); }
    if (targets.rows.length !== p) return error('#NUM!'); return admitMatrix([Array.from({length:targets.rows[0]!.length},(_,i) => at(targets.rows.map(row => row[i]!)))],host);
  }
  const coefficients = [...model.coefficients.slice(1)].reverse().concat(model.coefficients[0]!).map(x => numericResult(exponential ? Math.exp(x) : x));
  if (!numberArg(args,3,host)) return admitMatrix([coefficients],host);
  const row = (x:number,y:number) => Array.from({length:p + 1},(_,i) => i === 0 ? numericResult(x) : i === 1 ? numericResult(y) : error('#N/A'));
  return admitMatrix([coefficients,[...model.errors.slice(1)].reverse().concat(model.errors[0]!).map((x,i) => !affine && i === p ? error('#N/A') : numericResult(x)),row(model.regression / model.total,Math.sqrt(model.residual / model.df)),row(model.regression / p / (model.residual / model.df),model.df),row(model.regression,model.residual)],host);
}
function logarithmicFit(args:readonly (Value | undefined)[],host:FunctionHost):Value {
  if (args[0]?.kind !== 'range' || args[1]?.kind !== 'range') return error('#VALUE!');
  const ys = statisticalNumbers(args[0],host), xs = statisticalNumbers(args[1],host); if (!Array.isArray(ys)) return ys; if (!Array.isArray(xs)) return xs;
  if (xs.length !== ys.length || xs.length < 3) return error('#VALUE!');
  if (new Set(xs).size < 3 || new Set(ys).size < 3) return error('#NUM!');
  const min = Math.min(...xs), max = Math.max(...xs), range = max - min, ym = statisticalMean(ys,host), accuracy = 10 ** Math.floor(Math.log10(range)) * 1e-6;
  const evaluate = (sign:number,c:number) => { const z = xs.map(x => { host.tick(); return Math.log(sign * (x - c)); }), zm = statisticalMean(z,host); let xy = 0, xx = 0; for (let i = 0; i < z.length; i++) { host.tick(); xy += (z[i]! - zm) * (ys[i]! - ym); xx += (z[i]! - zm) ** 2; } const slope = xy / xx, intercept = ym - slope * zm; let residual = 0; for (let i = 0; i < z.length; i++) { host.tick(); residual += (intercept + slope * z[i]! - ys[i]!) ** 2; } return [sign,intercept,slope,c,residual]; };
  const plus = evaluate(1,min - range * 100)[4]! < evaluate(1,min - range * 100 - range * .05)[4]!, minus = evaluate(-1,max + range * 100)[4]! < evaluate(-1,max + range * 100 + range * .05)[4]!;
  if (plus === minus) return error('#NUM!'); const sign = plus ? 1 : -1, offset = accuracy * (plus ? Math.floor(min / accuracy) : Math.ceil(max / accuracy));
  if (evaluate(sign,offset - sign * 2 * accuracy)[4]! >= evaluate(sign,offset - sign * accuracy)[4]!) return error('#NUM!');
  const end = offset - sign * range * 100; let distance = range * 50, result = evaluate(sign,end + sign * distance);
  do { host.tick(); distance /= 2; result = evaluate(sign,result[3]!); let next = evaluate(sign,result[3]! + sign * distance); if (next[4]! <= result[4]!) result = next; else { next = evaluate(sign,result[3]! - sign * distance); if (next[4]! <= result[4]!) result = next; } } while (distance > accuracy);
  result = evaluate(sign,accuracy * Math.round(result[3]! / accuracy));
  return sign * (result[3]! - end) < 1.1 * accuracy ? error('#NUM!') : admitMatrix([result.map(numericResult)],host);
}
export const regressionFunctions: Readonly<Record<string,FunctionImplementation>> = {
  ...Object.fromEntries(['LINEST','LOGEST','LOGREG','TREND','GROWTH'].map(name => [name,(a,h) => regression(name,a,h)])),
  LOGFIT:logarithmicFit,
  LEVERAGE:(a,h) => {
    const rows = h.matrix(a[0]!).rows;
    if (!rows.length || rows.some(row => row.some(c => c.kind !== 'number'))) return error('#VALUE!');
    const xs = rows.map(row => row.map(c => c.kind === 'number' ? c.value : NaN)), dim = xs[0]!.length;
    if (dim * dim > h.context.limits.cells) throw new SsconvertError('resource-limit','ssconvert calculation array limit exceeded');
    const gram = Array.from({length:dim},(_,i) => Array.from({length:dim},(_,j) => sum(xs.map(row => row[i]! * row[j]!),h.tick)));
    const inverse = qrInverse(gram,1e-14,false,h); if (!inverse) return error('#NUM!');
    const result = xs.map(row => [numericResult(sum(row.map((x,i) => x * sum(row.map((y,j) => y * inverse[i]![j]!),h.tick)),h.tick))]);
    return admitMatrix(result,h);
  },
};

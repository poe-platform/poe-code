// SPDX-License-Identifier: GPL-2.0-or-later
import { SsconvertError } from "../../contracts.js";
import { logGamma } from "./scientific.js";
import { normalProbability, normalQuantile } from "./normal-distribution.js";
import type { FunctionHost } from "./types.js";
import { smallParameterBeta, sourceSmallABeta } from './statistics-beta.js';
import { sourceBetaQuantile } from './statistics-inverse.js';
import { capturedExp, fusedMultiplyAdd } from './numeric-arithmetic.js';

export function logComplement(logp: number): number {
  return logp > -Math.LN2 ? Math.log(-Math.expm1(logp)) : Math.log1p(-Math.exp(logp));
}
function selectTail(logp: number, directLower: boolean, lower: boolean, log: boolean): number {
  const result = directLower === lower ? logp : logComplement(logp);
  return log ? result : Math.exp(result);
}
/** Positive gamma series / continued fraction; both tails evaluated in log space. */
export function gammaProbability(x: number, shape: number, lower: boolean, log: boolean, host: FunctionHost): number {
  if (shape < 0 || Number.isNaN(x) || Number.isNaN(shape)) return NaN;
  if (x <= 0) return shape === 0 && x === 0 ? lower ? log ? 0 : 1 : log ? -Infinity : 0 : lower ? log ? -Infinity : 0 : log ? 0 : 1;
  if (shape === 0 || x === Infinity) return lower ? log ? 0 : 1 : log ? -Infinity : 0;
  const factor = shape * Math.log(x) - x - logGamma(shape,host);
  if (x < shape + 1) {
    let term = 1 / shape, total = term;
    for (let i = 1; ; i++) { host.tick(); term *= x / (shape + i); total += term; if (term <= total * Number.EPSILON / 2) break; }
    return selectTail(factor + Math.log(total),true,lower,log);
  }
  const tiny = 1e-300; let b = x + 1 - shape, c = 1 / tiny, d = 1 / b, total = d;
  for (let i = 1; ; i++) {
    host.tick(); const a = -i * (i - shape); b += 2; d = a * d + b; if (Math.abs(d) < tiny) d = tiny; c = b + a / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; const delta = d * c; total *= delta; if (Math.abs(delta - 1) <= Number.EPSILON * 2) break;
  }
  return selectTail(factor + Math.log(total),false,lower,log);
}
function betaFraction(x: number, a: number, b: number, host: FunctionHost): number {
  const tiny = 1e-300; let c = 1, d = 1 - (a + b) * x / (a + 1); if (Math.abs(d) < tiny) d = tiny; d = 1 / d; let total = d;
  for (let m = 1; ; m++) {
    host.tick(); const twice = 2 * m;
    const advance = (coefficient: number): number => { d = 1 + coefficient * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + coefficient / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; const delta = d * c; total *= delta; return delta; };
    advance(m * (b - m) * x / ((a + twice - 1) * (a + twice)));
    const delta = advance(-(a + m) * (a + b + m) * x / ((a + twice) * (a + twice + 1)));
    if (Math.abs(delta - 1) < Number.EPSILON * 4) return total;
  }
}
export function betaProbability(x: number, a: number, b: number, lower: boolean, log: boolean, host: FunctionHost): number {
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(x)) return NaN;
  if (x <= 0) return lower ? log ? -Infinity : 0 : log ? 0 : 1;
  if (x >= 1) return lower ? log ? 0 : 1 : log ? -Infinity : 0;
  if (a < 1 && (b < 1 || (1 + b) * x <= 1)) return sourceSmallABeta(x,a,b,lower,log,host);
  if (b < 1 && (1 + a) * (1 - x) <= 1) return sourceSmallABeta(1 - x,b,a,!lower,log,host);
  if (b < 1 && a >= 1 && (1 + a) * (1 - x) > 1) return smallParameterBeta(x,b,a,lower,log,host);
  if (a < 1 && b >= 1 && (1 + b) * x > 1) return smallParameterBeta(1 - x,a,b,!lower,log,host);
  const directLower = x < (a + 1) / (a + b + 2), y = directLower ? x : 1 - x, aa = directLower ? a : b, bb = directLower ? b : a;
  const factor = aa * Math.log(y) + bb * Math.log1p(-y) - (logGamma(aa,host) + logGamma(bb,host) - logGamma(aa + bb,host));
  return selectTail(factor + Math.log(betaFraction(y,aa,bb,host) / aa),directLower,lower,log);
}
export function inverseProbability(probability: number, lower: boolean, log: boolean, cdf: (x: number, lower: boolean, log: boolean) => number, minimum: number, maximum: number, discrete: boolean, host: FunctionHost): number {
  if (log ? probability > 0 : probability < 0 || probability > 1) return NaN;
  const logp = log ? probability : Math.log(probability);
  if (logp === -Infinity) return lower ? minimum : maximum;
  if (logp === 0) return lower ? maximum : minimum;
  // Compare the smaller tail, so 1-p is never rounded to one in an extreme tail.
  const smallLower = logp <= -Math.LN2 ? lower : !lower, target = logp <= -Math.LN2 ? logp : logComplement(logp);
  let lo = minimum, hi = maximum;
  if (!Number.isFinite(lo)) { lo = -1; while (cdf(lo,smallLower,true) > target === smallLower) { host.tick(); lo *= 2; if (!Number.isFinite(lo)) return -Infinity; } }
  if (!Number.isFinite(hi)) { hi = Math.max(1,lo + 1); while (cdf(hi,smallLower,true) < target === smallLower) { host.tick(); hi *= 2; if (!Number.isFinite(hi)) return Infinity; } }
  for (let i = 0; i < 1100; i++) {
    host.tick(); const mid = discrete ? Math.floor(lo + (hi - lo) / 2) : lo / 2 + hi / 2;
    if (mid === lo || mid === hi) return discrete ? hi : mid;
    const value = cdf(mid,smallLower,true);
    if (Number.isNaN(value)) return NaN;
    if (smallLower ? value < target : value > target) lo = mid; else hi = mid;
    if (discrete && hi - lo <= 1) return hi;
  }
  return NaN;
}
export interface Distribution {
  readonly parameters: number;
  readonly minimum: number | ((p: readonly number[]) => number);
  readonly maximum: number | ((p: readonly number[]) => number);
  readonly discrete?: boolean;
  valid(p: readonly number[]): boolean;
  density(x: number, p: readonly number[], host: FunctionHost): number; // log density
  probability(x: number, p: readonly number[], lower: boolean, log: boolean, host: FunctionHost): number;
  quantile?(x: number, p: readonly number[], lower: boolean, log: boolean, host: FunctionHost): number;
}
const positive = (x: number | undefined) => x !== undefined && x > 0;
const nonnegative = (x: number | undefined) => x !== undefined && x >= 0;
const unit = (x: number | undefined) => x !== undefined && x >= 0 && x <= 1;
const integer = (x: number | undefined) => x !== undefined && x >= 0 && Number.isInteger(x);
function logChoose(n: number, k: number, host: FunctionHost): number { return k < 0 || k > n ? -Infinity : logGamma(n + 1,host) - logGamma(k + 1,host) - logGamma(n - k + 1,host); }
/** Released Hill inverse-t expansion when the smaller probability underflows. */
function underflowStudentQuantile(x:number,df:number,lower:boolean,host:FunctionHost):number | undefined {
  host.tick();
  const target=x<=-Math.LN2?x:logComplement(x), negative=x<=-Math.LN2?lower:!lower;
  if(df<=2.1||df>1e20||Math.exp(target)>2**-1022)return undefined;
  const a=1/(df-.5), b=48/(a*a);
  const c=fusedMultiplyAdd(fusedMultiplyAdd(20700*a/b-98,a,-16),a,Number('96.36'));
  const d=((94.5/(b+c)-3)/b+1)*Math.sqrt(a*Math.PI/2)*df;
  const exponent=(Math.log(d)+Math.LN2+target)/df;
  if(exponent>=-Math.LN2*53)return undefined;
  return (negative?-1:1)*Math.sqrt(df)*capturedExp(-exponent);
}
export const distributions: Readonly<Record<string, Distribution>> = {
  norm: { parameters:2, minimum:-Infinity, maximum:Infinity, valid:p => nonnegative(p[1]), density:(x,p) => p[1] === 0 ? x === p[0] ? Infinity : -Infinity : -.5 * ((x - p[0]!) / p[1]!) ** 2 - Math.log(p[1]!) - .5 * Math.log(2 * Math.PI), probability:(x,p,l,g) => normalProbability(p[1] === 0 ? x < p[0]! ? -Infinity : Infinity : (x - p[0]!) / p[1]!,l,g), quantile:(x,p,l,g) => p[1] === 0 ? p[0]! : p[0]! + p[1]! * normalQuantile(x,l,g) },
  beta: { parameters:2, minimum:0, maximum:1, valid:p => positive(p[0]) && positive(p[1]), density:(x,p,h) => x < 0 || x > 1 ? -Infinity : x === 0 ? p[0]! < 1 ? Infinity : p[0] === 1 ? Math.log(p[1]!) : -Infinity : x === 1 ? p[1]! < 1 ? Infinity : p[1] === 1 ? Math.log(p[0]!) : -Infinity : (p[0]! - 1) * Math.log(x) + (p[1]! - 1) * Math.log1p(-x) - logGamma(p[0]!,h) - logGamma(p[1]!,h) + logGamma(p[0]! + p[1]!,h), probability:(x,p,l,g,h) => betaProbability(x,p[0]!,p[1]!,l,g,h) },
  gamma: { parameters:2, minimum:0, maximum:Infinity, valid:p => nonnegative(p[0]) && positive(p[1]), density:(x,p,h) => x < 0 ? -Infinity : p[0] === 0 ? x === 0 ? Infinity : -Infinity : x === 0 ? p[0]! < 1 ? Infinity : p[0] === 1 ? -Math.log(p[1]!) : -Infinity : (p[0]! - 1) * Math.log(x / p[1]!) - x / p[1]! - logGamma(p[0]!,h) - Math.log(p[1]!), probability:(x,p,l,g,h) => gammaProbability(x / p[1]!,p[0]!,l,g,h) },
  exp: { parameters:1, minimum:0, maximum:Infinity, valid:p => positive(p[0]), density:(x,p) => x < 0 ? -Infinity : -x / p[0]! - Math.log(p[0]!), probability:(x,p,l,g) => selectTail(x <= 0 ? 0 : -x / p[0]!,false,l,g), quantile:(x,p,l,g) => -p[0]! * (l ? logComplement(g ? x : Math.log(x)) : g ? x : Math.log(x)) },
  cauchy: { parameters:2, minimum:-Infinity, maximum:Infinity, valid:p => positive(p[1]), density:(x,p) => -Math.log(Math.PI * p[1]!) - Math.log1p(((x - p[0]!) / p[1]!) ** 2), probability:(x,p,l,g) => { const z = (x - p[0]!) / p[1]!, tail = Math.atan(1 / Math.abs(z)) / Math.PI; if (Math.abs(z) > 1) return (z < 0) === l ? g ? Math.log(tail) : tail : g ? Math.log1p(-tail) : .5 - tail + .5; const value = .5 + Math.atan(l ? z : -z) / Math.PI; return g ? Math.log(value) : value; }, quantile:(x,p,l,g) => { const probability = g ? Math.exp(x) : x; return p[0]! + (l ? -1 : 1) * p[1]! / Math.tan(Math.PI * probability); } },
  weibull: { parameters:2, minimum:0, maximum:Infinity, valid:p => positive(p[0]) && positive(p[1]), density:(x,p) => x < 0 ? -Infinity : x === 0 ? p[0]! < 1 ? Infinity : p[0] === 1 ? -Math.log(p[1]!) : -Infinity : Math.log(p[0]! / p[1]!) + (p[0]! - 1) * Math.log(x / p[1]!) - (x / p[1]!) ** p[0]!, probability:(x,p,l,g) => selectTail(x <= 0 ? 0 : -((x / p[1]!) ** p[0]!),false,l,g), quantile:(x,p,l,g) => p[1]! * (-(l ? logComplement(g ? x : Math.log(x)) : g ? x : Math.log(x))) ** (1 / p[0]!) },
  rayleigh: { parameters:1, minimum:0, maximum:Infinity, valid:p => positive(p[0]), density:(x,p) => x <= 0 ? -Infinity : Math.log(x) - 2 * Math.log(p[0]!) - .5 * (x / p[0]!) ** 2, probability:(x,p,l,g) => selectTail(x <= 0 ? 0 : -.5 * (x / p[0]!) ** 2,false,l,g), quantile:(x,p,l,g) => p[0]! * Math.sqrt(-2 * (l ? logComplement(g ? x : Math.log(x)) : g ? x : Math.log(x))) },
  gumbel: { parameters:2, minimum:-Infinity, maximum:Infinity, valid:p => positive(p[1]), density:(x,p) => { const z = (x - p[0]!) / p[1]!; return -z - Math.exp(-z) - Math.log(p[1]!); }, probability:(x,p,l,g) => selectTail(-Math.exp(-(x - p[0]!) / p[1]!),true,l,g), quantile:(x,p,l,g) => p[0]! - p[1]! * Math.log(-(l ? g ? x : Math.log(x) : logComplement(g ? x : Math.log(x)))) },
  binom: { parameters:2, minimum:0, maximum:p => p[0]!, discrete:true, valid:p => integer(p[0]) && unit(p[1]), density:(x,p,h) => !Number.isInteger(x) || x < 0 || x > p[0]! ? -Infinity : p[1] === 0 ? x === 0 ? 0 : -Infinity : p[1] === 1 ? x === p[0] ? 0 : -Infinity : logChoose(p[0]!,x,h) + x * Math.log(p[1]!) + (p[0]! - x) * Math.log1p(-p[1]!), probability:(x,p,l,g,h) => { const k = Math.floor(x); if (k < 0) return l ? g ? -Infinity : 0 : g ? 0 : 1; if (k >= p[0]!) return l ? g ? 0 : 1 : g ? -Infinity : 0; if (p[1] === 0) return l ? g ? 0 : 1 : g ? -Infinity : 0; if (p[1] === 1) return l ? g ? -Infinity : 0 : g ? 0 : 1; return betaProbability(p[1]!,k + 1,p[0]! - k,!l,g,h); } },
  pois: { parameters:1, minimum:0, maximum:Infinity, discrete:true, valid:p => nonnegative(p[0]), density:(x,p,h) => !Number.isInteger(x) || x < 0 ? -Infinity : p[0] === 0 ? x === 0 ? 0 : -Infinity : x * Math.log(p[0]!) - p[0]! - logGamma(x + 1,h), probability:(x,p,l,g,h) => x < 0 ? l ? g ? -Infinity : 0 : g ? 0 : 1 : p[0] === 0 ? l ? g ? 0 : 1 : g ? -Infinity : 0 : gammaProbability(p[0]!,Math.floor(x) + 1,!l,g,h) },
  geom: { parameters:1, minimum:0, maximum:Infinity, discrete:true, valid:p => positive(p[0]) && unit(p[0]), density:(x,p) => !Number.isInteger(x) || x < 0 ? -Infinity : p[0] === 1 ? x === 0 ? 0 : -Infinity : Math.log(p[0]!) + x * Math.log1p(-p[0]!), probability:(x,p,l,g) => selectTail(x < 0 ? 0 : (Math.floor(x) + 1) * Math.log1p(-p[0]!),false,l,g) },
  nbinom: { parameters:2, minimum:0, maximum:Infinity, discrete:true, valid:p => nonnegative(p[0]) && positive(p[1]) && unit(p[1]), density:(x,p,h) => !Number.isInteger(x) || x < 0 ? -Infinity : p[0] === 0 || p[1] === 1 ? x === 0 ? 0 : -Infinity : logGamma(x + p[0]!,h) - logGamma(p[0]!,h) - logGamma(x + 1,h) + p[0]! * Math.log(p[1]!) + x * Math.log1p(-p[1]!), probability:(x,p,l,g,h) => x < 0 ? l ? g ? -Infinity : 0 : g ? 0 : 1 : p[0] === 0 || p[1] === 1 ? l ? g ? 0 : 1 : g ? -Infinity : 0 : betaProbability(p[1]!,p[0]!,Math.floor(x) + 1,l,g,h) },
  hyper: { parameters:3, minimum:p => Math.max(0,p[2]! - p[1]!), maximum:p => Math.min(p[0]!,p[2]!), discrete:true, valid:p => integer(p[0]) && integer(p[1]) && integer(p[2]) && p[2]! <= p[0]! + p[1]!, density:(x,p,h) => Number.isInteger(x) ? logChoose(p[0]!,x,h) + logChoose(p[1]!,p[2]! - x,h) - logChoose(p[0]! + p[1]!,p[2]!,h) : -Infinity, probability:(x,p,l,g,h) => { const low = Math.max(0,p[2]! - p[1]!), high = Math.min(p[0]!,p[2]!), end = Math.floor(x); if (end < low || end >= high) return end < low === l ? g ? -Infinity : 0 : g ? 0 : 1; let total = -Infinity; for (let k = l ? low : Math.max(low,end + 1); k <= (l ? Math.min(end,high) : high); k++) { h.tick(); const term = distributions.hyper!.density(k,p,h), max = Math.max(total,term); total = max === -Infinity ? max : max + Math.log1p(Math.exp(Math.min(total,term) - max)); } return g ? total : Math.exp(total); } },
  t: { parameters:1, minimum:-Infinity, maximum:Infinity, valid:p => positive(p[0]), density:(x,p,h) => logGamma((p[0]! + 1) / 2,h) - logGamma(p[0]! / 2,h) - .5 * Math.log(p[0]! * Math.PI) - (p[0]! + 1) / 2 * Math.log1p(x * x / p[0]!), probability:(x,p,l,g,h) => { if (!Number.isFinite(p[0])) return normalProbability(x,l,g); const square = x * x, direct = p[0]! > square, coordinate = direct ? square / (p[0]! + square) : 1 / (1 + (x / p[0]!) * x), value = betaProbability(coordinate,direct ? .5 : p[0]! / 2,direct ? p[0]! / 2 : .5,!direct,g,h); if (g) return selectTail(value - Math.LN2,x <= 0,l,true); const tail = value / 2; return (x <= 0) === l ? tail : .5 - tail + .5; } },
  f: { parameters:2, minimum:0, maximum:Infinity, valid:p => positive(p[0]) && positive(p[1]), density:(x,p,h) => x < 0 ? -Infinity : x === 0 ? p[0]! < 2 ? Infinity : p[0] === 2 ? 0 : -Infinity : p[0]! / 2 * Math.log(p[0]! / p[1]!) + (p[0]! / 2 - 1) * Math.log(x) - (p[0]! + p[1]!) / 2 * Math.log1p(p[0]! * x / p[1]!) - logGamma(p[0]! / 2,h) - logGamma(p[1]! / 2,h) + logGamma((p[0]! + p[1]!) / 2,h), probability:(x,p,l,g,h) => { if (x <= 0) return l ? g ? -Infinity : 0 : g ? 0 : 1; const ratio = p[0]! / p[1]! * x; return ratio <= 1 ? betaProbability(ratio / (1 + ratio),p[0]! / 2,p[1]! / 2,l,g,h) : betaProbability(1 / (1 + ratio),p[1]! / 2,p[0]! / 2,!l,g,h); } },
};
export function distributionValue(family: string, operation: string, x: number, p: readonly number[], lower: boolean, log: boolean, host: FunctionHost): number {
  const d = distributions[family];
  if (!d) throw new SsconvertError('unsupported-feature',`Unsupported distribution ${family}`);
  if (Number.isNaN(x) || operation === 'q' && (log ? x > 0 : x < 0 || x > 1)) return NaN;
  // Released scalar helpers apply different parameter checks by operation.
  if (family === 'gamma' && operation === 'q') {
    if (p[0]! <= 0) return NaN;
    if (p[1]! <= 0) return distributionValue(family,operation,x,[p[0]!,1],lower,log,host) * p[1]!;
  }
  if (family === 'exp' && operation !== 'd' && p[0] === 0) {
    if (operation === 'q') return -p[0] * (lower ? logComplement(log ? x : Math.log(x)) : log ? x : Math.log(x));
    return x <= 0 ? lower ? log ? -Infinity : 0 : log ? 0 : 1 : lower ? log ? 0 : 1 : log ? -Infinity : 0;
  }
  if (family === 'cauchy' && operation === 'q' && p[1] === 0) return d.quantile!(x,p,lower,log,host);
  if (family === 'beta') {
    if (operation === 'p') return betaProbability(x,p[0]!,p[1]!,lower,log,host);
    if (p.some(value=>value<0)) return NaN;
    if (operation === 'q') {
      const lb = p.some(value=>value===0) ? Infinity : logGamma(p[0]!,host) + logGamma(p[1]!,host) - logGamma(p[0]! + p[1]!,host);
      return sourceBetaQuantile(x,p[0]!,p[1]!,lower,log,lb,(y,l,g)=>betaProbability(y,p[0]!,p[1]!,l,g,host),(y,g)=>distributionValue(family,'d',y,p,true,g,host),host);
    }
    if (p.some(value=>value===0)) {
      const mass = x === 0 && p[0] === 0 || x === 1 && p[1] === 0;
      return mass ? Infinity : log ? -Infinity : 0;
    }
  }
  if (!d.valid(p) || Number.isNaN(x) || operation === 'q' && (log ? x > 0 : x < 0 || x > 1)) return NaN;
  if (operation === 'd') { const value = d.density(x,p,host); return log ? value : Math.exp(value); }
  if (operation === 'p') return d.probability(x,p,lower,log,host);
  const lo = typeof d.minimum === 'number' ? d.minimum : d.minimum(p), hi = typeof d.maximum === 'number' ? d.maximum : d.maximum(p);
  if (x === (log ? -Infinity : 0)) return lower ? lo : hi;
  if (x === (log ? 0 : 1)) return lower ? hi : lo;
  if (family === 'nbinom' && log) {
    const converted = lower ? Math.exp(x) : -Math.expm1(x);
    // Released qnbinom checks its converted probability against the original
    // log-mode boundary macros, then applies its near-one continuity hack.
    if (converted === (lower ? -Infinity : 0)) return 0;
    if (converted === (lower ? 0 : -Infinity) || converted + 1.01 * Number.EPSILON >= 1) return Infinity;
  }
  if (d.quantile) return d.quantile(x,p,lower,log,host);
  if (family === 't' && log) {
    const extreme=underflowStudentQuantile(x,p[0]!,lower,host);
    if(extreme!==undefined)return extreme;
  }
  return inverseProbability(x,lower,log,(y,l,g) => d.probability(y,p,l,g,host),d.discrete ? lo - 1 : lo,hi,d.discrete ?? false,host);
}

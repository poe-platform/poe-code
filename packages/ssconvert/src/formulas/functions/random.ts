// SPDX-License-Identifier: GPL-2.0-or-later
import { error, numericResult, sum } from '../values.js';
import { collect, numberArg } from './common.js';
import { statisticalNumbers } from './statistics-range.js';
import { distributionValue } from './probability.js';
import { normalProbability, normalQuantile } from './normal-distribution.js';
import { landauRandom } from './landau.js';
import { uniformRandom } from './random-source.js';
import type { FunctionHost, FunctionImplementation, SpecialForm } from './types.js';
function openRandom(host: FunctionHost): number { let x: number; do { x = uniformRandom(host); } while (x === 0); return x; }
function normalRandom(host: FunctionHost): number {
  let u: number, v: number, r: number;
  do { u = 2 * uniformRandom(host) - 1; v = 2 * uniformRandom(host) - 1; r = u * u + v * v; } while (r > 1 || r === 0);
  return u * Math.sqrt(-2 * Math.log(r) / r);
}
function gammaRandom(shape: number, scale: number, host: FunctionHost): number {
  if (shape < 0 || scale < 0) return NaN;
  if (shape === 0 || scale === 0) return 0;
  if (shape < 1) return gammaRandom(shape + 1,scale,host) * openRandom(host) ** (1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { host.tick(); const x = normalRandom(host), t = 1 + c * x; if (t <= 0) continue; const v = t * t * t, u = openRandom(host); if (u < 1 - .0331 * x ** 4 || Math.log(u) < .5 * x * x + d * (1 - v + Math.log(v))) return scale * d * v; }
}
function skewNormal(shape: number, host: FunctionHost): number { const delta = shape / Math.hypot(1,shape), u = normalRandom(host), v = normalRandom(host), x = delta * u + Math.sqrt(1 - delta * delta) * v; return u < 0 ? -x : x; }
export const randomFunctions: Readonly<Record<string, FunctionImplementation>> = {
  RAND: (_a,h) => numericResult(uniformRandom(h)),
  RANDUNIFORM:(a,h) => { const lo = numberArg(a,0,h), hi = numberArg(a,1,h); return lo > hi ? error('#NUM!') : numericResult(lo + uniformRandom(h) * (hi - lo)); },
  RANDBETWEEN:(a,h) => { const bottom = numberArg(a,0,h), top = numberArg(a,1,h), lo = Math.ceil(bottom), hi = Math.floor(top); return bottom > top || lo > hi ? error('#NUM!') : numericResult(lo + Math.floor(uniformRandom(h) * (hi - lo + 1))); },
  RANDBERNOULLI:(a,h) => { const p = numberArg(a,0,h); return p < 0 || p > 1 ? error('#NUM!') : numericResult(uniformRandom(h) < p ? 1 : 0); },
  RANDEXP:(a,h) => { const scale = numberArg(a,0,h); return scale < 0 ? error('#NUM!') : numericResult(-scale * Math.log(uniformRandom(h))); },
  RANDNORM:(a,h) => { const sd = numberArg(a,1,h); return sd < 0 ? error('#NUM!') : numericResult(numberArg(a,0,h) + sd * normalRandom(h)); },
  RANDLOGNORM:(a,h) => { const sd = numberArg(a,1,h); return sd < 0 ? error('#NUM!') : numericResult(Math.exp(numberArg(a,0,h) + sd * normalRandom(h))); },
  RANDCAUCHY:(a,h) => { const scale = numberArg(a,0,h); return scale < 0 ? error('#NUM!') : numericResult(scale * Math.tan(Math.PI * (openRandom(h) - .5))); },
  RANDWEIBULL:(a,h) => { const scale = numberArg(a,0,h), shape = numberArg(a,1,h); return scale < 0 || shape <= 0 ? error('#NUM!') : numericResult(scale === 0 ? 0 : scale * (-Math.log(openRandom(h))) ** (1 / shape)); },
  RANDLAPLACE:(a,h) => { const scale = numberArg(a,0,h); if (scale < 0) return error('#NUM!'); let u: number; do { u = uniformRandom(h) * 2 - 1; } while (u === 0); return numericResult(u < 0 ? scale * Math.log(-u) : -scale * Math.log(u)); },
  RANDLOGISTIC:(a,h) => { const scale = numberArg(a,0,h); if (scale < 0) return error('#NUM!'); const u = openRandom(h); return numericResult(scale * Math.log(u / (1 - u))); },
  RANDRAYLEIGH:(a,h) => { const scale = numberArg(a,0,h); return scale < 0 ? error('#NUM!') : numericResult(scale * Math.sqrt(-2 * Math.log(openRandom(h)))); },
  RANDRAYLEIGHTAIL:(a,h) => { const lo = numberArg(a,0,h), sd = numberArg(a,1,h); return sd < 0 ? error('#NUM!') : numericResult(Math.sqrt(lo * lo - 2 * sd * sd * Math.log(openRandom(h)))); },
  RANDPARETO:(a,h) => { const shape = numberArg(a,0,h), scale = numberArg(a,1,h); return shape <= 0 || scale <= 0 ? error('#NUM!') : numericResult(scale / openRandom(h) ** (1 / shape)); },
  RANDGAMMA:(a,h) => numericResult(gammaRandom(numberArg(a,0,h),numberArg(a,1,h),h)),
  RANDBETA:(a,h) => { const x = numberArg(a,0,h), y = numberArg(a,1,h); if (x <= 0 || y <= 0) return error('#NUM!'); const u = gammaRandom(x,1,h), v = gammaRandom(y,1,h); return numericResult(u / (u + v)); },
  RANDCHISQ:(a,h) => { const df = numberArg(a,0,h); return df <= 0 ? error('#NUM!') : numericResult(gammaRandom(df / 2,2,h)); },
  RANDFDIST:(a,h) => { const x = numberArg(a,0,h), y = numberArg(a,1,h); return x <= 0 || y <= 0 ? error('#NUM!') : numericResult(gammaRandom(x / 2,2,h) / x / (gammaRandom(y / 2,2,h) / y)); },
  RANDTDIST:(a,h) => { const df = numberArg(a,0,h); return df <= 0 ? error('#NUM!') : numericResult(normalRandom(h) / Math.sqrt(gammaRandom(df / 2,2,h) / df)); },
  RANDSNORM:(a,h) => { const shape = numberArg(a,0,h), mean = numberArg(a,1,h), sd = numberArg(a,2,h,1); return sd < 0 ? error('#NUM!') : numericResult(mean + sd * (shape === 0 ? normalRandom(h) : skewNormal(shape,h))); },
  RANDSTDIST:(a,h) => { const df = numberArg(a,0,h), shape = numberArg(a,1,h); return df <= 0 ? error('#NUM!') : numericResult((shape === 0 ? normalRandom(h) : skewNormal(shape,h)) / Math.sqrt(gammaRandom(df / 2,2,h) / df)); },
  RANDPOISSON:(a,h) => { const mean = numberArg(a,0,h); return mean < 0 ? error('#NUM!') : numericResult(distributionValue('pois','q',uniformRandom(h),[mean],true,false,h)); },
  RANDBINOM:(a,h) => { const p = numberArg(a,0,h), n = numberArg(a,1,h); return p < 0 || p > 1 || n < 0 ? error('#NUM!') : numericResult(distributionValue('binom','q',uniformRandom(h),[Math.floor(n),p],true,false,h)); },
  RANDNEGBINOM:(a,h) => { const p = numberArg(a,0,h), n = numberArg(a,1,h); return p < 0 || p > 1 || n < 1 ? error('#NUM!') : numericResult(distributionValue('nbinom','q',uniformRandom(h),[Math.floor(n),p],true,false,h)); },
  RANDGEOM:(a,h) => { const p = numberArg(a,0,h); return p < 0 || p > 1 ? error('#NUM!') : numericResult(distributionValue('geom','q',uniformRandom(h),[p],true,false,h)); },
  RANDHYPERG:(a,h) => { const p = [Math.floor(numberArg(a,0,h)),Math.floor(numberArg(a,1,h)),Math.floor(numberArg(a,2,h))]; if (p.some(x => x < 0) || p[2]! > p[0]! + p[1]!) return error('#NUM!'); return numericResult(distributionValue('hyper','q',uniformRandom(h),p,true,false,h)); },
  RANDGUMBEL:(a,h) => { const shape = numberArg(a,0,h), b = numberArg(a,1,h), type = numberArg(a,2,h,1); if (shape === 0 || b <= 0 || type !== 1 && type !== 2) return error('#NUM!'); const u = openRandom(h); return numericResult(type === 1 ? (Math.log(b) - Math.log(-Math.log(u))) / shape : (-b / Math.log(u)) ** (1 / shape)); },
  RANDNORMTAIL:(a,h) => { const lo = numberArg(a,0,h), sd = numberArg(a,1,h); if (sd <= 0) return error('#NUM!'); const logtail = normalProbability(lo / sd,false,true); return numericResult(sd * normalQuantile(logtail + Math.log(openRandom(h)),false,true)); },
  RANDEXPPOW:(a,h) => { const scale = numberArg(a,0,h), shape = numberArg(a,1,h); if (scale <= 0 || shape <= 0) return error('#NUM!'); const sign = uniformRandom(h) < .5 ? -1 : 1; return numericResult(sign * scale * gammaRandom(1 / shape,1,h) ** (1 / shape)); },
  RANDLANDAU:(_a,h) => numericResult(landauRandom(h)),
  RANDLEVY:(a,h) => { const c = numberArg(a,0,h), alpha = numberArg(a,1,h), beta = numberArg(a,2,h); if (c <= 0 || alpha <= 0 || alpha > 2 || beta < -1 || beta > 1) return error('#NUM!'); const v = Math.PI * (openRandom(h) - .5), w = -Math.log(openRandom(h)), half = Math.PI / 2; if (alpha === 1) return numericResult(c * (((half + beta * v) * Math.tan(v) - beta * Math.log(half * w * Math.cos(v) / (half + beta * v))) / half + beta * Math.log(c) / half)); const t = beta * Math.tan(half * alpha), b = Math.atan(t) / alpha, s = (1 + t * t) ** (1 / (2 * alpha)); return numericResult(c * s * Math.sin(alpha * (v + b)) / Math.cos(v) ** (1 / alpha) * (Math.cos(v - alpha * (v + b)) / w) ** ((1 - alpha) / alpha)); },
  RANDLOG:(a,h) => { const p = numberArg(a,0,h); if (p <= 0 || p >= 1) return error('#NUM!'); let target = uniformRandom(h), term = -p / Math.log1p(-p), k = 1; while (target >= term) { h.tick(); target -= term; term *= p * k / (k + 1); k++; } return numericResult(k); },
  RANDDISCRETE:(a,h) => { const values = statisticalNumbers(a[0]!,h), probs = a[1] && statisticalNumbers(a[1],h); if (!Array.isArray(values)) return values; if (probs && !Array.isArray(probs)) return probs; if (!values.length || probs && (probs.length !== values.length || probs.some(x => x < 0) || Math.abs(sum(probs,h.tick) - 1) > 1e-10)) return error('#NUM!'); let u = uniformRandom(h), i = 0; if (probs) { for (; i < probs.length; i++) { h.tick(); u -= probs[i]!; if (u < 0) break; } } else i = Math.floor(u * values.length); return numericResult(values[Math.min(i,values.length - 1)]!); },
};
export const simtable: SpecialForm = (nodes,host) => {
  for (const node of nodes) { const values = collect(host.evaluate(node,true),host); const first = values.find(v => v.kind !== 'blank'); if (first) return first; }
  return error('#N/A');
};

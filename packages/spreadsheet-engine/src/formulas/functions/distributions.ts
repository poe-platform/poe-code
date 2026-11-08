import { landauDensity } from "./landau.js";
import { advancedDistributionValue, owensT } from "./statistics-advanced-distributions.js";
// SPDX-License-Identifier: GPL-2.0-or-later
import { numericResult, error, sum } from "../values.js";
import { numberArg } from "./common.js";
import { fakeFloor } from "./floating-point.js";
import { distributionValue, distributions } from "./probability.js";
import { normalProbability, normalQuantile } from "./normal-distribution.js";
import { logGamma } from "./scientific.js";
import { normalInterval } from "./special-numeric.js";
import { statisticsFunctionDescriptors } from "../statistics-function-descriptors.js";
import type { FunctionImplementation } from "./types.js";

const rFunctions: Record<string, FunctionImplementation> = {};
for (const [name, descriptor] of Object.entries(statisticsFunctionDescriptors)) {
  if (descriptor.group !== 'fn-r') continue;
  const family = name.slice(3).toLowerCase(), operation = name[2]!.toLowerCase();
  rFunctions[name] = (args,host) => {
    // CHISQ and LNORM share the underlying gamma and normal numerical engine.
    const parameterCount = descriptor.signature!.split('|')[0]!.length - 1;
    const p = Array.from({length:parameterCount},(_,i) => numberArg(args,i + 1,host));
    const lower = operation === 'd' ? true : numberArg(args,parameterCount + 1,host,1) !== 0;
    const log = numberArg(args,parameterCount + (operation === 'd' ? 1 : 2),host) !== 0;
    const x = numberArg(args,0,host);
    if (["snorm","st"].includes(family)) return numericResult(advancedDistributionValue(family,operation,x,p,lower,log,host));
    if (family === "tukey") return numericResult(advancedDistributionValue(family,operation,x,[...p,numberArg(args,3,host,1)],numberArg(args,4,host,1) !== 0,numberArg(args,5,host) !== 0,host));
    if (family === 'chisq') return numericResult(distributionValue('gamma',operation,x,[p[0]! / 2,2],lower,log,host));
    if (family === 'lnorm') {
      if (p[1]! < 0 || operation !== 'q' && p[1] === 0) return error('#NUM!');
      if (operation === 'q') return numericResult(Math.exp(distributionValue('norm','q',x,p,lower,log,host)));
      if (operation === 'p') return numericResult(x <= 0 ? log ? -Infinity : 0 : normalProbability((Math.log(x) - p[0]!) / p[1]!,lower,log));
      const density = x <= 0 ? -Infinity : distributions.norm!.density(Math.log(x),p,host) - Math.log(x);
      return numericResult(log ? density : Math.exp(density));
    }
    return numericResult(distributionValue(family,operation,x,p,lower,log,host));
  };
}
export const distributionFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ...rFunctions,
  LANDAU:(a,h) => numericResult(landauDensity(numberArg(a,0,h))),
  OWENT:(a,h) => numericResult(owensT(numberArg(a,0,h),numberArg(a,1,h),h)),
  NORMSDIST:(a,h) => numericResult(normalProbability(numberArg(a,0,h))),
  NORMSINV:(a,h) => numericResult(normalQuantile(numberArg(a,0,h))),
  NORMDIST:(a,h) => { const sd = numberArg(a,2,h); return sd <= 0 ? error('#NUM!') : numericResult(distributionValue('norm',numberArg(a,3,h) ? 'p' : 'd',numberArg(a,0,h),[numberArg(a,1,h),sd],true,false,h)); },
  NORMINV:(a,h) => { const sd = numberArg(a,2,h); return sd <= 0 ? error('#NUM!') : numericResult(distributionValue('norm','q',numberArg(a,0,h),[numberArg(a,1,h),sd],true,false,h)); },
  'SNORM.DIST.RANGE':(a,h) => numericResult(normalInterval(numberArg(a,0,h),numberArg(a,1,h),h)),
  BETADIST:(a,h) => { const x = numberArg(a,0,h), lo = numberArg(a,3,h), hi = numberArg(a,4,h,1), p=[numberArg(a,1,h),numberArg(a,2,h)]; return x < lo || x > hi || lo >= hi || p.some(x=>x<=0) ? error('#NUM!') : numericResult(distributionValue('beta','p',(x - lo) / (hi - lo),p,true,false,h)); },
  'BETA.DIST':(a,h) => { const x = numberArg(a,0,h), lo = numberArg(a,4,h), hi = numberArg(a,5,h,1), cdf = numberArg(a,3,h) !== 0, p=[numberArg(a,1,h),numberArg(a,2,h)]; return x < lo || x > hi || lo >= hi || p.some(x=>x<=0) ? error('#NUM!') : numericResult(distributionValue('beta',cdf ? 'p' : 'd',(x - lo) / (hi - lo),p,true,false,h) / (cdf ? 1 : hi - lo)); },
  BETAINV:(a,h) => { const lo = numberArg(a,3,h), hi = numberArg(a,4,h,1), p=[numberArg(a,1,h),numberArg(a,2,h)]; return lo >= hi || p.some(x=>x<=0) ? error('#NUM!') : numericResult(lo + (hi - lo) * distributionValue('beta','q',numberArg(a,0,h),p,true,false,h)); },
  BINOMDIST:(a,h) => { const x = fakeFloor(numberArg(a,0,h)), n = fakeFloor(numberArg(a,1,h)); return x < 0 || x > n ? error('#NUM!') : numericResult(distributionValue('binom',numberArg(a,3,h) ? 'p' : 'd',x,[n,numberArg(a,2,h)],true,false,h)); },
  'BINOM.DIST.RANGE':(a,h) => { const n = fakeFloor(numberArg(a,0,h)), p = numberArg(a,1,h), lo = fakeFloor(numberArg(a,2,h)), hi = fakeFloor(numberArg(a,3,h,lo)); if (n < 0 || p < 0 || p > 1) return error('#NUM!'); const terms: number[] = []; for (let i = Math.max(0,lo); i <= Math.min(hi,n); i++) { h.tick(); terms.push(distributionValue('binom','d',i,[n,p],true,false,h)); } return numericResult(sum(terms,h.tick)); },
  CRITBINOM:(a,h) => numericResult(distributionValue('binom','q',numberArg(a,2,h),[fakeFloor(numberArg(a,0,h)),numberArg(a,1,h)],true,false,h)),
  BERNOULLI:(a,h) => { const x = numberArg(a,0,h), p = numberArg(a,1,h); return x !== 0 && x !== 1 || p < 0 || p > 1 ? error('#NUM!') : numericResult(x ? p : 1 - p); },
  CAUCHY:(a,h) => numericResult(distributionValue('cauchy',numberArg(a,2,h) ? 'p' : 'd',numberArg(a,0,h),[0,numberArg(a,1,h)],false,false,h)),
  CHIDIST:(a,h) => { const df = fakeFloor(numberArg(a,1,h)); return df < 1 ? error('#NUM!') : numericResult(distributionValue('gamma','p',numberArg(a,0,h),[df / 2,2],false,false,h)); },
  CHIINV:(a,h) => { const df = fakeFloor(numberArg(a,1,h)); return df < 1 ? error('#NUM!') : numericResult(distributionValue('gamma','q',numberArg(a,0,h),[df / 2,2],false,false,h)); },
  EXPONDIST:(a,h) => { const x = numberArg(a,0,h), rate = numberArg(a,1,h); return x < 0 || rate <= 0 ? error('#NUM!') : numericResult(distributionValue('exp',numberArg(a,2,h) ? 'p' : 'd',x,[1 / rate],true,false,h)); },
  GAMMADIST:(a,h) => { const x = numberArg(a,0,h), shape = numberArg(a,1,h); return x < 0 || shape <= 0 ? error('#NUM!') : numericResult(distributionValue('gamma',numberArg(a,3,h) ? 'p' : 'd',x,[shape,numberArg(a,2,h)],true,false,h)); },
  GAMMAINV:(a,h) => { const shape = numberArg(a,1,h), scale=numberArg(a,2,h); return shape <= 0 || scale<=0 ? error('#NUM!') : numericResult(distributionValue('gamma','q',numberArg(a,0,h),[shape,scale],true,false,h)); },
  FDIST:(a,h) => { const x = numberArg(a,0,h), p = [fakeFloor(numberArg(a,1,h)),fakeFloor(numberArg(a,2,h))]; return x < 0 || p.some(n => n < 1) ? error('#NUM!') : numericResult(distributionValue('f','p',x,p,false,false,h)); },
  FINV:(a,h) => { const p = [fakeFloor(numberArg(a,1,h)),fakeFloor(numberArg(a,2,h))]; return p.some(n => n < 1) ? error('#NUM!') : numericResult(distributionValue('f','q',numberArg(a,0,h),p,false,false,h)); },
  TDIST:(a,h) => { const x = numberArg(a,0,h), df = numberArg(a,1,h), tails = numberArg(a,2,h); return df < 1 || tails !== 1 && tails !== 2 || tails === 2 && x < 0 ? error('#NUM!') : numericResult(tails * distributionValue('t','p',Math.abs(x),[df],x < 0,false,h)); },
  TINV:(a,h) => { const df = numberArg(a,1,h); return df < 1 ? error('#NUM!') : numericResult(distributionValue('t','q',numberArg(a,0,h) / 2,[df],false,false,h)); },
  POISSON:(a,h) => { const x = fakeFloor(numberArg(a,0,h)), mean = numberArg(a,1,h); return x < 0 || mean <= 0 ? error('#NUM!') : numericResult(distributionValue('pois',numberArg(a,2,h) ? 'p' : 'd',x,[mean],true,false,h)); },
  GEOMDIST:(a,h) => { const x = fakeFloor(numberArg(a,0,h)); return x < 0 ? error('#NUM!') : numericResult(distributionValue('geom',numberArg(a,2,h) ? 'p' : 'd',x,[numberArg(a,1,h)],true,false,h)); },
  HYPGEOMDIST:(a,h) => { const x = fakeFloor(numberArg(a,0,h)), n = fakeFloor(numberArg(a,1,h)), m = fakeFloor(numberArg(a,2,h)), total = fakeFloor(numberArg(a,3,h)); return x < 0 || x > m || n < 0 || m < 0 || total < 0 || n > total ? error('#NUM!') : numericResult(distributionValue('hyper',numberArg(a,4,h) ? 'p' : 'd',x,[m,total - m,n],true,false,h)); },
  NEGBINOMDIST:(a,h) => { const x = fakeFloor(numberArg(a,0,h)), r = fakeFloor(numberArg(a,1,h)); return x + r - 1 <= 0 ? error('#NUM!') : numericResult(distributionValue('nbinom','d',x,[r,numberArg(a,2,h)],true,false,h)); },
  WEIBULL:(a,h) => { const x = numberArg(a,0,h); return x < 0 ? error('#NUM!') : numericResult(distributionValue('weibull',numberArg(a,3,h) ? 'p' : 'd',x,[numberArg(a,1,h),numberArg(a,2,h)],true,false,h)); },
  LOGINV:(a,h) => { const sd = numberArg(a,2,h); return sd <= 0 ? error('#NUM!') : numericResult(Math.exp(distributionValue('norm','q',numberArg(a,0,h),[numberArg(a,1,h),sd],true,false,h))); },
  LOGNORMDIST:(a,h) => { const x = numberArg(a,0,h), mean = numberArg(a,1,h), sd = numberArg(a,2,h); return x <= 0 || mean < 0 || sd <= 0 ? error('#NUM!') : numericResult(normalProbability((Math.log(x) - mean) / sd)); },
  CONFIDENCE:(a,h) => { const n = fakeFloor(numberArg(a,2,h)), sd = numberArg(a,1,h); return n === 0 ? error('#DIV/0!') : n < 0 || sd <= 0 ? error('#NUM!') : numericResult(-normalQuantile(numberArg(a,0,h) / 2) * sd / Math.sqrt(n)); },
  'CONFIDENCE.T':(a,h) => { const n = fakeFloor(numberArg(a,2,h)), sd = numberArg(a,1,h); return n === 1 ? error('#DIV/0!') : n < 1 || sd <= 0 ? error('#NUM!') : numericResult(-distributionValue('t','q',numberArg(a,0,h) / 2,[n - 1],true,false,h) * sd / Math.sqrt(n)); },
  LAPLACE:(a,h) => { const scale = numberArg(a,1,h); return scale <= 0 ? error('#NUM!') : numericResult(Math.exp(-Math.abs(numberArg(a,0,h)) / scale) / (2 * scale)); },
  LOGISTIC:(a,h) => { const scale = numberArg(a,1,h), z = Math.exp(-Math.abs(numberArg(a,0,h) / scale)); return scale <= 0 ? error('#NUM!') : numericResult(z / (scale * (1 + z) ** 2)); },
  PARETO:(a,h) => { const x = numberArg(a,0,h), shape = numberArg(a,1,h), scale = numberArg(a,2,h); return shape <= 0 || scale <= 0 ? error('#NUM!') : numericResult(x < scale ? 0 : shape / x * (scale / x) ** shape); },
  RAYLEIGH:(a,h) => numericResult(distributionValue('rayleigh','d',numberArg(a,0,h),[numberArg(a,1,h)],true,false,h)),
  RAYLEIGHTAIL:(a,h) => { const x = numberArg(a,0,h), lo = numberArg(a,1,h), sd = numberArg(a,2,h); return sd <= 0 ? error('#NUM!') : numericResult(x < lo ? 0 : x / sd / sd * Math.exp((lo - x) * (lo + x) / (2 * sd * sd))); },
  EXPPOWDIST:(a,h) => { const scale = numberArg(a,1,h), shape = numberArg(a,2,h); return shape <= 0 ? error('#NUM!') : numericResult(Math.exp(-(Math.abs(numberArg(a,0,h) / scale) ** shape) - logGamma(1 + 1 / shape,h)) / (2 * scale)); },
};

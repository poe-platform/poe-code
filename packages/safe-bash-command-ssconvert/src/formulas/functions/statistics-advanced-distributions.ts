// SPDX-License-Identifier: GPL-2.0-or-later
// Gnumeric fn-r/extra.c and mathfunc.c Hartley/Studentized range algorithms.
import { normalProbability } from './normal-distribution.js';
import { distributionValue, distributions } from './probability.js';
import { gamma, logGamma } from './scientific.js';
import type { FunctionHost } from './types.js';
import { capturedExp, fusedMultiplyAdd } from './numeric-arithmetic.js';
import { sourceContinuousInverse } from './statistics-inverse.js';

const owenMethods = [
  1,1,2,13,13,13,13,13,13,13,13,16,16,16,9,
  1,2,2,3,3,5,5,14,14,15,15,16,16,16,9,
  2,2,3,3,3,5,5,15,15,15,15,16,16,16,10,
  2,2,3,5,5,5,5,7,7,16,16,16,16,16,10,
  2,3,3,5,5,6,6,8,8,17,17,17,12,12,11,
  2,3,5,5,5,6,6,8,8,17,17,17,12,12,12,
  2,3,4,4,6,6,8,8,17,17,17,17,17,12,12,
  2,3,4,4,6,6,18,18,18,18,17,17,17,12,12,
];
const owenCoefficients = [Number(".99999999999999987510"),-Number(".99999999999988796462"),Number(".99999999998290743652"),-Number(".99999999896282500134"),Number(".99999996660459362918"),-Number(".99999933986272476760"),Number(".99999125611136965852"),-Number(".99991777624463387686"),Number(".99942835555870132569"),-Number(".99697311720723000295"),Number(".98751448037275303682"),-Number(".95915857980572882813"),Number(".89246305511006708555"),-Number(".76893425990463999675"),Number(".58893528468484693250"),-Number(".38380345160440256652"),Number(".20317601701045299653"),-Number(".082813631607004984866"),Number(".024167984735759576523"),-Number(".0044676566663971825242"),Number(".00039141169402373836468")];
const owenPoints = [Number(".0035082039676451715489"),Number(".031279042338030753740"),Number(".085266826283219451090"),Number(".16245071730812277011"),Number(".25851196049125434828"),Number(".36807553840697533536"),Number(".48501092905604697475"),Number(".60277514152618576821"),Number(".71477884217753226516"),Number(".81475510988760098605"),Number(".89711029755948965867"),Number(".95723808085944261843"),Number(".99178832974629703586")];
const owenWeights = [Number(".018831438115323502887"),Number(".018567086243977649478"),Number(".018042093461223385584"),Number(".017263829606398753364"),Number(".016243219975989856730"),Number(".014994592034116704829"),Number(".013535474469662088392"),Number(".011886351605820165233"),Number(".010070377242777431897"),Number(".0081130545742299586629"),Number(".0060419009528470238773"),Number(".0038862217010742057883"),Number(".0016793031084546090448")];
function centeredNormal(x: number, host: FunctionHost): number {
  if (Math.abs(x) >= .125) return normalProbability(x) - .5;
  let total = 0, term = x / Math.sqrt(2 * Math.PI), i = 0;
  do { host.tick(); total += term / (2 * i + 1); term *= -x * x / (2 * (++i)); } while (Math.abs(term) >= Math.abs(total) * Number.EPSILON && term !== 0);
  return total;
}
function owenHelper(h: number, a: number, host: FunctionHost): number {
  const hs = h * h, as = a * a;
  const ai = [.025,.09,.15,.36,.5,.9,.99999].findIndex(x => a <= x), hi = [.02,.06,.09,.125,.26,.4,.6,1.6,1.7,2.33,2.4,3.36,3.4,4.8].findIndex(x => h <= x);
  const method = owenMethods[(ai < 0 ? 7 : ai) * 15 + (hi < 0 ? 14 : hi)]!;
  let value = 0;
  if (method <= 8) {
    const order = [2,3,4,5,7,10,12,18][method - 1]!, exponent = -.5 * hs;
    let aj = a / (2 * Math.PI), dj = Math.expm1(exponent), gj = exponent * Math.exp(exponent);
    value = Math.atan(a) / Math.PI / 2;
    for (let j = 1; j <= order; j++) { host.tick(); value += dj * aj / (j + j - 1); aj *= as; dj = gj - dj; gj *= exponent / (j + 1); }
    return value;
  }
  if (method <= 12) {
    const order = method === 9 ? 10 : method === 11 ? 30 : 20;
    let vi = a * Math.exp(-.5 * (a * h) ** 2) / Math.sqrt(2 * Math.PI), z = centeredNormal(a * h,host) / h;
    if (method === 12) for (let i = 0; i <= order; i++) { host.tick(); value += z * owenCoefficients[i]!; z = ((i + i + 1) * z - vi) / hs; vi *= as; }
    else for (let i = 1; i <= 2 * order + 1; i += 2) { host.tick(); value += z; z = (vi - i * z) / hs; vi *= -as; }
    return value * Math.exp(-.5 * hs) / Math.sqrt(2 * Math.PI);
  }
  if (method <= 16) {
    const order = method === 13 ? 4 : method === 14 ? 7 : method === 15 ? 8 : 20;
    let term = a * Math.exp(-.5 * hs * (1 + as)) / (2 * Math.PI), y = 1;
    for (let i = 1; i <= 2 * order + 1; i += 2) { host.tick(); value += term * y; y = (1 - hs * y) / (i + 2); term *= -as; }
    return value;
  }
  if (method === 17) {
    for (let i = 0; i < 13; i++) { host.tick(); const r = 1 + as * owenPoints[i]!; value += owenWeights[i]! * Math.exp(-.5 * hs * r) / r; }
    return value * a;
  }
  const nh = normalProbability(h,false), y = 1 - a, r = Math.atan2(y,1 + a);
  return .5 * nh * (1 - nh) - (r === 0 ? 0 : r * Math.exp(-.5 * y * hs / r) / (2 * Math.PI));
}
/** Released Patefield/Tandy region selection and bounded recurrence orders. */
export function owensT(h: number, a: number, host: FunctionHost): number {
  if (a === 0) return 0;
  const sign = Math.sign(a); h = Math.abs(h); a = Math.abs(a); host.tick();
  if (h === 0) return sign * Math.atan(a) / Math.PI / 2;
  if (a === 1) return sign * .5 * normalProbability(h) * normalProbability(h,false);
  if (a <= 1) return sign * owenHelper(h,a,host);
  const ah = a * h, nh = normalProbability(h,false), nah = normalProbability(ah,false);
  return sign * ((h <= .67 ? .25 - centeredNormal(h,host) * centeredNormal(ah,host) : .5 * (nh + nah) - nh * nah) - owenHelper(ah,1 / a,host));
}
function skewNormalProbability(x: number,p:readonly number[],lower:boolean,log:boolean,host:FunctionHost):number {
  let h = (x - p[1]!) / p[2]!, shape = p[0]!;
  if (!lower) { h = -h; shape = -shape; }
  if (shape === 0) return normalProbability(h,true,log);
  const result = Math.abs(shape) < 10 ? normalProbability(h) - 2 * owensT(h,shape,host) : normalProbability(h * shape) * (2 * normalProbability(h) - 1) + 2 * owensT(h * shape,1 / shape,host);
  const value = Math.max(0,Math.min(1,result)); return log ? Math.log(value) : value;
}
const stirlingHalves = [NaN,Number(".1534264097200273452913848"),Number(".0810614667953272582196702"),Number(".0548141210519176538961390"),Number(".0413406959554092940938221"),Number(".03316287351993628748511048"),Number(".02767792568499833914878929"),Number(".02374616365629749597132920"),Number(".02079067210376509311152277"),Number(".01848845053267318523077934"),Number(".01664469118982119216319487"),Number(".01513497322191737887351255"),Number(".01387612882307074799874573"),Number(".01281046524292022692424986"),Number(".01189670994589177009505572"),Number(".01110455975820691732662991"),Number(".010411265261972096497478567"),Number(".009799416126158803298389475"),Number(".009255462182712732917728637"),Number(".008768700134139385462952823"),Number(".008330563433362871256469318"),Number(".007934114564314020547248100"),Number(".007573675487951840794972024"),Number(".007244554301320383179543912"),Number(".006942840107209529865664152"),Number(".006665247032707682442354394"),Number(".006408994188004207068439631"),Number(".006171712263039457647532867"),Number(".005951370112758847735624416"),Number(".005746216513010115682023589"),Number(".005554733551962801371038690")];
/** The skew-t integer recurrence only requests positive half-integer arguments. */
function stirlingError(n:number,host:FunctionHost):number {
  host.tick();
  if (n <= 15) return stirlingHalves[n * 2]!;
  const square = n * n, coefficients = [1 / 12,1 / 360,1 / 1260,1 / 1680,1 / 1188,691 / 360360,1 / 156];
  const terms = n > 3043 ? 2 : n > 200.2 ? 3 : n > 55.57 ? 4 : n > 27.01 ? 5 : n > 17.23 ? 6 : 7;
  let result = coefficients[terms - 1]!;
  for (let i = terms - 2; i >= 0; i--) { host.tick(); result = coefficients[i]! - result / square; }
  return result / n;
}
function skewTProbability(x:number,p:readonly number[],lower:boolean,log:boolean,host:FunctionHost):number {
  let n = p[0]!, shape = p[1]!;
  if (shape === 0) return distributions.t!.probability(x,[n],lower,log,host);
  if (n > 100) return skewNormalProbability(x,[shape,0,1],lower,log,host);
  if (!Number.isInteger(n)) return NaN;
  if (!lower) { x = -x; shape = -shape; }
  let total = 0;
  while (n > 2) {
    host.tick(); const v = n - 1, d = v === 2 ? Math.LN2 - Math.log(Math.PI) + Math.log(3) / 2 : fusedMultiplyAdd(-.5,Math.log(v - 2) + Math.log(v + 1),fusedMultiplyAdd(v / 2,Math.log1p(-1 / (v - 1)) + Math.log(v + 1),.5 + Math.LN2 / 2 - Math.log(Math.PI) / 2)) + stirlingError(v / 2 - 1,host) - stirlingError((v - 1) / 2,host), a = v + 1 + x * x;
    total = fusedMultiplyAdd(x * capturedExp(fusedMultiplyAdd(-v / 2,Math.log(a),d)),distributions.t!.probability(Math.sqrt(v) * shape * x / Math.sqrt(a),[v],true,false,host),total);
    n -= 2; x *= Math.sqrt((v - 1) / (v + 1));
  }
  if (n === 1) total += (Math.atan(x) + Math.acos(shape / Math.sqrt((1 + shape * shape) * (1 + x * x)))) / Math.PI;
  else { const f = x / Math.sqrt(2 + x * x), shiftedAtan = (z:number) => z > 0 ? -Math.atan(1 / z) : Math.atan(z) - Math.PI / 2; total += fusedMultiplyAdd(f,shiftedAtan(-shape * f),shiftedAtan(shape)) / -Math.PI; }
  total = Math.max(0,Math.min(1,total));
  return log ? Math.log(total) : total;
}
const rangeNodes = [Number(".981560634246719250690549090149"),Number(".904117256370474856678465866119"),Number(".769902674194304687036893833213"),Number(".587317954286617447296702418941"),Number(".367831498998180193752691536644"),Number(".125233408511468915472441369464")];
const rangeWeights = [Number(".047175336386511827194615961485"),Number(".106939325995318430960254718194"),Number(".160078328543346226334652529543"),Number(".203167426723065921749064455810"),Number(".233492536538354808760849898925"),Number(".249147045813402785000562436043")];
function rangeProbability(w:number,ranges:number,means:number,host:FunctionHost):number {
  const half = w * .5; let total = half > 1 ? Math.exp(means * Math.log1p(-2 * normalProbability(half,false))) : (2 * centeredNormal(half,host)) ** means;
  if (total >= 1) return 1;
  let left = half; const increment = 3 / Math.log1p(means);
  // Every quadrature abscissa is at least this positive first-node bound.
  // A narrower-than-half-ulp interval has identical rounded endpoints there
  // and at all subsequent nodes, so source pnorm2 contributes exactly zero.
  const firstNode = half + increment * .5 * (1 - rangeNodes[0]!);
  if (w < 2 ** (Math.floor(Math.log2(firstNode)) - 53)) return total ** ranges;
  for (;;) {
    host.tick(); const center = left + increment * .5; let partial = 0;
    for (let j = 0; j < 12; j++) { host.tick(); const node = j >= 6 ? rangeNodes[11 - j]! : -rangeNodes[j]!, weight = rangeWeights[j >= 6 ? 11 - j : j]!, v = fusedMultiplyAdd(increment * .5,node,center); const probability = normalInterval(v - w,v,host); partial = fusedMultiplyAdd(probability ** (means - 1) * weight,normalDensityExponential(v),partial); }
    partial *= increment * means / Math.sqrt(2 * Math.PI); total += partial;
    if (total >= 1) { total = 1; break; }
    if (partial <= total * Number.EPSILON / 2) break;
    left += increment;
  }
  return total ** ranges;
}
function normalDensityExponential(x:number):number {
  x=Math.abs(x);if(x<4)return capturedExp(-.5*x*x);
  if(x>=10+Math.sqrt(2148*Math.LN2))return 0;
  const high=Math.round(x*65536)/65536,low=x-high;
  return capturedExp(-.5*high*high)*capturedExp(fusedMultiplyAdd(-.5,low,-high)*low);
}
/** Source sf-dpq.c pnorm2 bounds a close interval by its endpoint densities. */
function normalInterval(lo:number,hi:number,host:FunctionHost):number {
  host.tick();if(Number.isNaN(lo)||Number.isNaN(hi))return NaN;
  if(lo>hi)return -normalInterval(hi,lo,host);if(lo===hi)return 0;
  if(lo===-Infinity)return normalProbability(hi);if(hi===Infinity)return normalProbability(lo,false);
  if(lo===0)return centeredNormal(hi,host);if(hi===0)return centeredNormal(-lo,host);
  if(lo<=0&&hi>=0){const small=Math.min(-lo,hi);return 2*normalInterval(0,small,host)+normalInterval(small,Math.max(-lo,hi),host);}
  if(lo<0)return normalInterval(-hi,-lo,host);
  const left=normalProbability(lo,false),right=normalProbability(hi,false),raw=left-right;
  if(Math.abs(raw)*32>Math.abs(left+right))return raw;
  const width=hi-lo,normalizer=1/Math.sqrt(2*Math.PI);
  return Math.min(Math.max(raw,width*normalDensityExponential(hi)*normalizer),width*normalDensityExponential(lo)*normalizer);
}
const tukeyNodes = [Number(".989400934991649932596154173450"),Number(".944575023073232576077988415535"),Number(".865631202387831743880467897712"),Number(".755404408355003033895101194847"),Number(".617876244402643748446671764049"),Number(".458016777657227386342419442984"),Number(".281603550779258913230460501460"),Number(".0950125098376374401853193354250")];
const tukeyWeights = [Number(".0271524594117540948517805724560"),Number(".0622535239386478928628438369944"),Number(".0951585116824927848099251076022"),Number(".124628971255533872052476282192"),Number(".149595988816576732081501730547"),Number(".169156519395002538189312079030"),Number(".182603415044923588866763667969"),Number(".189450610455068496285396723208")];
// Compensated atanh reduction avoids host Math.log's one-ulp quadrature drift.
function quadratureLog(x:number):number {
  const exponent = Math.floor(Math.log2(x * Math.SQRT2)), m = x / 2 ** exponent;
  const numerator = m - 1, denominator = m + 1, y = numerator / denominator;
  const denominatorLow = m - (denominator - 1);
  const yLow = (fusedMultiplyAdd(-y,denominator,numerator) - y * denominatorLow) / denominator;
  const square = y * y, squareLow = fusedMultiplyAdd(y,y,-square) + 2 * y * yLow;
  let power = y, powerLow = yLow, sum = y, low = yLow;
  for(let n=3;n<=39;n+=2) {
    const next = power * square;
    powerLow = fusedMultiplyAdd(power,square,-next) + powerLow * square + power * squareLow; power = next;
    const term = power / n, termLow = (fusedMultiplyAdd(-term,n,power) + powerLow) / n;
    const nextSum = sum + term, offset = nextSum - sum;
    low += (sum - (nextSum - offset)) + (term - offset) + termLow; sum = nextSum;
  }
  const high = exponent * Math.LN2, highLow = fusedMultiplyAdd(exponent,Math.LN2,-high) + exponent * 2.3190468138462996e-17;
  const value = high + 2 * sum, offset = value - high;
  return value + ((high - (value - offset)) + (2 * sum - offset) + highLow + 2 * low);
}
type TukeyQuadratureCache = Map<string, readonly (readonly [number,number,number,number])[]>;
export function tukeyProbability(q:number,means:number,df:number,ranges:number,lower:boolean,log:boolean,host:FunctionHost,cache?:TukeyQuadratureCache):number {
  if (q <= 0) return lower ? log ? -Infinity : 0 : log ? 0 : 1;
  if (df < 2 || ranges < 1 || means < 2) return NaN;
  if (q === Infinity) return lower ? log ? 0 : 1 : log ? -Infinity : 0;
  let total = 0;
  if (df > 25000) total = rangeProbability(q,ranges,means,host);
  else {
    const f2 = df * .5, factorialGamma = Number.isInteger(f2) && f2 <= 171 ? Math.log(gamma(f2,host)) : logGamma(f2,host), constant = fusedMultiplyAdd(f2,Math.log(f2),-factorialGamma);
    let increment = df <= 100 ? 1 : df <= 800 ? .5 : df <= 5000 ? .25 : .125;
    const integral = (lo:number,hi:number) => {
      const key = `${lo}:${hi}`; let nodes = cache?.get(key);
      if(!nodes) {
        const center = (lo + hi) * .5, length = hi - lo;
        nodes = Array.from({length:16},(_,j):readonly [number,number,number,number] => {
          host.tick(); const node = j >= 8 ? tukeyNodes[15 - j]! : -tukeyNodes[j]!, weight = tukeyWeights[j >= 8 ? 15 - j : j]!;
          const u = fusedMultiplyAdd(node,.5 * length,center), exponent = fusedMultiplyAdd(-u,f2,fusedMultiplyAdd(f2 - 1,quadratureLog(u),constant));
          return [Math.sqrt(u),.5 * length,capturedExp(exponent),weight];
        });
        if(cache && (cache.size + 1) * 16 <= host.context.limits.cells) cache.set(key,nodes);
      }
      let value = 0;
      for(const [root,halfLength,density,weight] of nodes) { host.tick(); const contribution = rangeProbability(q * root,ranges,means,host) * halfLength * density; if(contribution !== 0) value = fusedMultiplyAdd(weight,contribution,value); }
      return value;
    };
    let hi = increment / 2;
    for (let i = 1; i <= 20; i++) { host.tick(); const lo = hi / (i + 1), partial = integral(lo,hi); total += partial; if (partial <= total * Number.EPSILON / 2) break; hi = lo; }
    let lo = increment / 2;
    for (let i = 1; i <= 150; i++) { host.tick(); hi = lo + increment; const partial = integral(lo,hi); total += partial; if (partial < total * Number.EPSILON && (total > 0 || lo > 2)) break; if (partial < total / 1000) increment *= 2; lo = hi; }
  }
  total = Math.min(total,1); const value = lower ? total : .5 - total + .5; return log ? Math.log(value) : value;
}
export const advancedDistributions = {
  snorm: { parameters:3, minimum:-Infinity, maximum:Infinity, valid:(p:readonly number[]) => p[2]! >= 0,
    density:(x:number,p:readonly number[],h:FunctionHost) => p[0] === 0 ? distributions.norm!.density(x,[p[1]!,p[2]!],h) : Math.LN2 + distributions.norm!.density(x,[p[1]!,p[2]!],h) + normalProbability(p[0]! * (x - p[1]!) / p[2]!,true,true), probability:skewNormalProbability },
  st: { parameters:2, minimum:-Infinity, maximum:Infinity, valid:(p:readonly number[]) => p[0]! > 0, density:(x:number,p:readonly number[],h:FunctionHost) => p[1] === 0 ? distributions.t!.density(x,[p[0]!],h) : Math.LN2 + distributions.t!.density(x,[p[0]!],h) + distributions.t!.probability(p[1]! * x * Math.sqrt((p[0]! + 1) / (x * x + p[0]!)),[p[0]! + 1],true,true,h), probability:skewTProbability },
};
export function advancedDistributionValue(family:string,operation:string,x:number,p:readonly number[],lower:boolean,log:boolean,host:FunctionHost):number {
  if (family === 'tukey') {
    if (operation === 'p') return tukeyProbability(x,p[0]!,p[1]!,p[2] ?? 1,lower,log,host);
    if (!log && x > .9) { x = 1 - x; lower = !lower; }
    const guess = Math.SQRT2 * distributionValue('t','q',(1 + x) / 2,[p[1]!],lower,log,host);
    const cache:TukeyQuadratureCache = new Map();
    return sourceContinuousInverse(x,lower,log,0,Infinity,guess,y => tukeyProbability(y,p[0]!,p[1]!,p[2] ?? 1,lower,log,host,cache),undefined,host);
  }
  const d = advancedDistributions[family as keyof typeof advancedDistributions]; if (!d.valid(p) && (family !== 'snorm' || operation === 'd' || p[0] === 0)) return NaN;
  if (operation === 'd') {
    // Released extra.c uses a different location expression in its nonlog branch.
    if (family === 'snorm' && p[0] !== 0 && !log) return 2 * Math.exp(distributions.norm!.density(x,[p[1]!,p[2]!],host)) * normalProbability((p[0]! * x - p[1]! / p[0]!) / p[2]!);
    const value = d.density(x,p,host); return log ? value : Math.exp(value);
  }
  if (operation === 'p') return family === 'st' && p[1] !== 0 && p[0]! <= 100 ? d.probability(x,p,lower,false,host) : d.probability(x,p,lower,log,host); // released extra.c drops the log result
  if (!log && x > .9) { x = 1 - x; lower = !lower; }
  return sourceContinuousInverse(x,lower,log,-Infinity,Infinity,0,y => advancedDistributionValue(family,'p',y,p,lower,log,host),y => advancedDistributionValue(family,'d',y,p,true,log,host),host);
}

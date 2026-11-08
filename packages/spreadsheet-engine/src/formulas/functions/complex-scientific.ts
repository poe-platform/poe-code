import { error, numericResult } from "../values.js";
import { numberArg, scalarArg } from "./common.js";
import { c, add, negate, multiply, divide, exponential, power, parse, result, type Complex } from "./complex.js";
import { gamma, logGamma } from "./scientific.js";
import { preciseHypot, sinPi } from "./math.js";
import type { FunctionHost, FunctionImplementation } from "./types.js";

// Rounded binary64 coefficients of the released rational Lanczos approximation.
const numerator = [56906521.913471565,103794043.11634454,86363131.2881386,43338889.32467614,
  14605578.087685067,3481712.154980646,601859.6171681099,75999.29304014542,6955.999602515376,
  449.9445569063168,19.519927882476175,.5098416655656676,.006061842346248907];
const denominator = [0,39916800,120543840,150917976,105258076,45995730,13339535,2637558,357423,32670,1925,66,1];
function complexGamma(z: Complex, host: FunctionHost): Complex {
  if (z.im === 0) return c(gamma(z.re, host), 0, z.unit);
  if (z.re < 0) {
    const angle = Math.PI * (z.re % 2), imaginary = Math.PI * z.im;
    const sine = c(Math.sin(angle) * Math.cosh(imaginary), Math.cos(angle) * Math.sinh(imaginary), z.unit);
    return divide(c(Math.PI), multiply(complexFactorial(negate(z), host), sine));
  }
  let p = c(numerator[12]!, 0, z.unit), q = c(denominator[12]!, 0, z.unit);
  for (let i = 11; i >= 0; i--) { host.tick(); p = add(multiply(p,z),c(numerator[i]!,0,z.unit)); q = add(multiply(q,z),c(denominator[i]!,0,z.unit)); }
  const shifted = add(z,c(-.5)), base = add(shifted,c(808618867/134217728));
  const f = power(base, c(shifted.re * .5, shifted.im * .5, z.unit), host);
  return multiply(multiply(multiply(f,exponential(negate(shifted))),f),divide(p,q));
}
function complexFactorial(z: Complex, host: FunctionHost): Complex {
  return z.im === 0 ? c(gamma(z.re + 1, host), 0, z.unit) : multiply(complexGamma(z, host), z);
}
function upperAsymptotic(a: Complex, z: Complex, host: FunctionHost): Complex | undefined {
  const magnitude = preciseHypot(z.re, z.im);
  if (preciseHypot(a.re, a.im) >= magnitude || 2 * magnitude < 53 * Math.LN2) return undefined;
  const previous = add(a, c(-1));
  let term = divide(divide(power(z, previous, host), exponential(z)), complexFactorial(previous, host)), retained = c(0);
  for (let i = 0; i < 100; i++) {
    host.tick(); retained = add(retained, term);
    if (preciseHypot(term.re, term.im) <= preciseHypot(retained.re, retained.im) * Number.EPSILON) return retained;
    term = multiply(divide(term, z), add(a, c(-i - 1)));
  }
  return undefined;
}
function positiveGamma(a: number, z: number, lower: boolean, host: FunctionHost): number {
  if (a === 0) return lower ? 1 : 0;
  if (z === 0) return lower ? 0 : 1;
  if (a === 1) return lower ? -Math.expm1(-z) : Math.exp(-z);
  let factor: number;
  if (a >= 16) {
    const reciprocal = 1 / a, square = reciprocal * reciprocal;
    const correction = reciprocal * (1 / 12 + square * (-1 / 360 + square * (1 / 1260 + square * (-1 / 1680 + square * (1 / 1188 + square * (-691 / 360360))))));
    factor = Math.sqrt(a / (2 * Math.PI)) * Math.exp(a * Math.log1p((z - a) / a) + (a - z) - correction);
  } else factor = Math.exp(a * Math.log(z) - z - logGamma(a, host));
  if (z < a + 1) {
    let term = 1/a, total = term, residual = 0;
    for (let i = 1; i < 10000; i++) {
      host.tick(); term *= z/(a+i); const adjusted = term - residual, next = total + adjusted;
      residual = (next - total) - adjusted;
      if(next===total)break;total=next;
    }
    const value = total*factor; return lower ? value : 1-value;
  }
  let b=z+1-a, cc=1e300, d=1/b, h=d;
  for(let i=1;i<10000;i++) {
    host.tick(); const an=-i*(i-a); b+=2; d=an*d+b; if(Math.abs(d)<1e-300)d=1e-300;
    cc=b+an/cc;if(Math.abs(cc)<1e-300)cc=1e-300;d=1/d;const delta=d*cc;h*=delta;
    if(Math.abs(delta-1)<=Number.EPSILON)break;
  }
  const value=factor*h;return lower?1-value:value;
}
function incompleteGamma(a: Complex, z: Complex, lower: boolean, regularized: boolean, host: FunctionHost): Complex {
  if(regularized && a.im===0 && a.re<=0 && a.re===Math.floor(a.re))return c(lower?1:0,0,z.unit);
  if(a.im===0 && a.re>=0 && z.im===0 && z.re>=0) {
    const value=positiveGamma(a.re,z.re,lower,host);
    return c(regularized?value:value*gamma(a.re,host),0,z.unit);
  }
  const upper = upperAsymptotic(a, z, host);
  if (upper) {
    let value = upper;
    if (z.im === 0 && z.re < 0 && a.im === 0 && a.re !== Math.floor(a.re)) {
      const l = add(c(1), negate(value)), magnitude = preciseHypot(l.re, l.im);
      value = add(c(1), negate(c(magnitude * sinPi(.5 - a.re), magnitude * sinPi(a.re))));
    }
    if (!regularized) value = multiply(value, complexGamma(a, host));
    // Released fixup retains its regularized marker even after denormalization.
    if (lower) value = add(c(1), negate(value));
    return c(value.re, value.im, z.unit);
  }
  // Lower continued fraction. Keep the four convergents scaled together.
  let a0=c(1),a1=c(0),b0=c(0),b1=c(1),converged=false;
  for(let i=1;i<100;i++) {
    host.tick();const ai=i===1?c(1):i%2?multiply(z,c(Math.floor(i/2))):multiply(z,negate(add(a,c(i/2-1))));
    const bi=add(a,c(i-1)),a2=add(multiply(bi,a1),multiply(ai,a0)),b2=add(multiply(bi,b1),multiply(ai,b0));
    a0=a1;a1=a2;b0=b1;b1=b2;
    const magnitude=Math.abs(b1.re)+Math.abs(b1.im);
    if(magnitude===0)return c(NaN,NaN,z.unit);
    if(magnitude>=2**64 || magnitude<=2**-64) {
      const scaling=2**-(Math.floor(Math.log2(magnitude))+1);
      a0=multiply(a0,c(scaling));a1=multiply(a1,c(scaling));b0=multiply(b0,c(scaling));b1=multiply(b1,c(scaling));
    }
    const difference=add(multiply(a1,b0),negate(multiply(a0,b1))),scale=multiply(b0,b1);
    if(Math.hypot(difference.re,difference.im)<=Math.hypot(scale.re,scale.im)*Number.EPSILON/2){converged=true;break;}
  }
  if(!converged)return c(NaN,NaN,z.unit);
  let value=multiply(multiply(divide(a1,b1),exponential(negate(z))),power(z,a,host));
  const ga=complexGamma(a,host);
  if(regularized)value=divide(value,ga);
  if(!lower)value=add(regularized?c(1):ga,negate(value));
  return c(value.re,value.im,z.unit);
}
export const complexScientificFunctions: Readonly<Record<string,FunctionImplementation>>={
  ...Object.fromEntries(["IMGAMMA","IMFACT"].map(name=>[name,((args,host)=>{
    const z=parse(scalarArg(args,0,host),host);if(!z)return error("#NUM!");
    const value=name==="IMFACT"?complexFactorial(z,host):complexGamma(z,host);
    return result(c(value.re,value.im,z.unit),host);
  }) satisfies FunctionImplementation])),
  IMIGAMMA:(args,host)=>{
    const a=parse(scalarArg(args,0,host),host),z=parse(scalarArg(args,1,host),host);
    return !a||!z?error("#NUM!"):result(incompleteGamma(a,z,numberArg(args,2,host,1)!==0,numberArg(args,3,host,1)!==0,host),host);
  },
  IGAMMA:(args,host)=>{
    const value=incompleteGamma(c(numberArg(args,0,host)),c(numberArg(args,1,host)),numberArg(args,2,host,1)!==0,numberArg(args,3,host,1)!==0,host);
    return numericResult(numberArg(args,4,host,1)!==0?value.re:value.im);
  }
};

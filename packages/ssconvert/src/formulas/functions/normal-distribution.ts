// SPDX-License-Identifier: GPL-2.0-or-later
// Lower-tail, non-log specialization of Gnumeric 1.12.61 mathfunc.c pnorm_both.
// Original algorithm: W. J. Cody; R adaptations by Ross Ihaka and the R Core team.
import { fusedMultiplyAdd } from './numeric-arithmetic.js';
const a = [Number("2.2352520354606839287"), Number("161.02823106855587881"), Number("1067.6894854603709582"), Number("18154.981253343561249"), Number(".065682337918207449113")];
const b = [Number("47.20258190468824187"), Number("976.09855173777669322"), Number("10260.932208618978205"), Number("45507.789335026729956")];
const c = [Number(".39894151208813466764"), Number("8.8831497943883759412"), Number("93.506656132177855979"), Number("597.27027639480026226"), Number("2494.5375852903726711"), Number("6848.1904505362823326"), Number("11602.651437647350124"), Number("9842.7148383839780218"), Number("1.0765576773720192317e-8")];
const d = [Number("22.266688044328115691"), Number("235.38790178262499861"), Number("1519.377599407554805"), Number("6485.558298266760755"), Number("18615.571640885098091"), Number("34900.952721145977266"), Number("38912.003286093271411"), Number("19685.429676859990727")];
const p = [Number(".21589853405795699"), Number(".1274011611602473639"), Number(".022235277870649807"), Number(".001421619193227893466"), Number("2.9112874951168792e-5"), Number(".02307344176494017303")];
const q = [Number("1.28426009614491121"), Number(".468238212480865118"), Number(".0659881378689285515"), Number(".00378239633202758244"), Number("7.29751555083966205e-5")];
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const y = Math.abs(x); let numerator: number, denominator: number, temp: number;
  if (y <= .67448975) {
    const square = y > Number.EPSILON / 2 ? x * x : 0;
    numerator = a[4]! * square; denominator = square;
    for (let i = 0; i < 3; i++) { numerator = (numerator + a[i]!) * square; denominator = (denominator + b[i]!) * square; }
    return .5 + x * (numerator + a[3]!) / (denominator + b[3]!);
  }
  if (y <= Math.sqrt(32)) {
    numerator = c[8]! * y; denominator = y;
    for (let i = 0; i < 7; i++) { numerator = (numerator + c[i]!) * y; denominator = (denominator + d[i]!) * y; }
    temp = (numerator + c[7]!) / (denominator + d[7]!);
  } else if (x > -37.5193 && x < 8.2924) {
    const square = 1 / (x * x); numerator = p[5]! * square; denominator = square;
    for (let i = 0; i < 4; i++) { numerator = (numerator + p[i]!) * square; denominator = (denominator + q[i]!) * square; }
    temp = (Number(".39894228040143267794") - square * (numerator + p[4]!) / (denominator + q[4]!)) / y;
  } else return x > 0 ? 1 : 0;
  const truncated = Math.trunc(y * 16) / 16, delta = (y - truncated) * (y + truncated);
  const lower = Math.exp(-truncated * truncated * .5) * Math.exp(-delta * .5) * temp;
  return x > 0 ? 1 - lower : lower;
}

/** Cody's rational tail, retaining log probabilities past binary64 underflow. */
export function normalProbability(x: number, lower = true, log = false): number {
  const z = lower ? x : -x;
  if (!log) return normalCdf(z);
  if (Number.isNaN(z)) return NaN;
  if (z === Infinity) return log ? 0 : 1;
  if (z === -Infinity) return log ? -Infinity : 0;
  const y = Math.abs(z);
  if (y <= Math.sqrt(32)) { const value = normalCdf(z); return log ? Math.log(value) : value; }
  const square = 1 / (y * y); let numerator = p[5]! * square, denominator = square;
  for (let i = 0; i < 4; i++) { numerator = (numerator + p[i]!) * square; denominator = (denominator + q[i]!) * square; }
  const ratio = (Number(".39894228040143267794") - square * (numerator + p[4]!) / (denominator + q[4]!)) / y;
  const tailLog = -y * y / 2 + Math.log(ratio);
  return z < 0 ? log ? tailLog : Math.exp(tailLog) : log ? Math.log1p(-Math.exp(tailLog)) : -Math.expm1(tailLog);
}

function polynomial(x: number, coefficients: readonly number[]): number {
  let value = coefficients[0]!;
  for (let i = 1; i < coefficients.length; i++) value = fusedMultiplyAdd(value,x,coefficients[i]!);
  return value;
}
/** AS241/Wichura, in the released mathfunc.c operation order. */
export function normalQuantile(probability: number, lower = true, log = false): number {
  if (Number.isNaN(probability) || (log ? probability > 0 : probability < 0 || probability > 1)) return NaN;
  if (probability === (log ? -Infinity : 0)) return lower ? -Infinity : Infinity;
  if (probability === (log ? 0 : 1)) return lower ? Infinity : -Infinity;
  const p = log ? lower ? Math.exp(probability) : -Math.expm1(probability) : lower ? probability : .5 - probability + .5;
  const q = p - .5;
  if (Math.abs(q) <= .425) {
    const r = .180625 - q * q;
    return q * polynomial(r,[Number("2509.0809287301226727"),Number("33430.575583588128105"),Number("67265.770927008700853"),Number("45921.953931549871457"),Number("13731.693765509461125"),Number("1971.5909503065514427"),Number("133.14166789178437745"),Number("3.387132872796366608")]) / polynomial(r,[Number("5226.495278852854561"),Number("28729.085735721942674"),Number("39307.89580009271061"),Number("21213.794301586595867"),Number("5394.1960214247511077"),Number("687.1870074920579083"),Number("42.313330701600911252"),1]);
  }
  const tail = q > 0 ? log ? lower ? -Math.expm1(probability) : Math.exp(probability) : lower ? .5 - probability + .5 : probability : p;
  let r = Math.sqrt(-(log && (lower && q <= 0 || !lower && q > 0) ? probability : Math.log(tail))), value: number;
  if (r <= 5) {
    r -= 1.6;
    value = polynomial(r,[Number("7.7454501427834140764e-4"),Number(".0227238449892691845833"),Number(".24178072517745061177"),Number("1.27045825245236838258"),Number("3.64784832476320460504"),Number("5.7694972214606914055"),Number("4.6303378461565452959"),Number("1.42343711074968357734")]) / polynomial(r,[Number("1.05075007164441684324e-9"),Number("5.475938084995344946e-4"),Number(".0151986665636164571966"),Number(".14810397642748007459"),Number(".68976733498510000455"),Number("1.6763848301838038494"),Number("2.05319162663775882187"),1]);
  } else {
    r -= 5;
    value = polynomial(r,[Number("2.01033439929228813265e-7"),Number("2.71155556874348757815e-5"),Number(".0012426609473880784386"),Number(".026532189526576123093"),Number(".29656057182850489123"),Number("1.7848265399172913358"),Number("5.4637849111641143699"),Number("6.6579046435011037772")]) / polynomial(r,[Number("2.04426310338993978564e-15"),Number("1.4215117583164458887e-7"),Number("1.8463183175100546818e-5"),Number("7.868691311456132591e-4"),Number(".0148753612908506148525"),Number(".13692988092273580531"),Number(".59983220655588793769"),1]);
  }
  return q < 0 ? -value : value;
}

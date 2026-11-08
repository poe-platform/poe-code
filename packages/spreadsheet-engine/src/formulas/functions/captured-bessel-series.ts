// Series/factorial decomposition adapted from Gnumeric sf-bessel.c/sf-gamma.c
// and GOffice go-quad.c, by Morten Welinder, under GNU GPL version 2 or,
// at your option, version 3, without warranty.
// See the package LICENSE. Trigonometric pairs use a bounded Taylor expansion.
import { add, subtract, product, multiply, divide, type Pair } from "./captured-quad.js";
import { fusedMultiplyAdd } from "./numeric-arithmetic.js";
import { capturedIntegerBesselY } from "./captured-bessel.js";
import { piReduced } from "./math.js";
import type { FunctionHost } from "./types.js";

const one: Pair = [1, 0], pi: Pair = [Math.PI, 1.2246467991473532e-16];
const e: Pair = [Math.E, 1.4456468917292502e-16];
interface Scaled { mantissa: Pair; exponent: number }
function value(a: Pair): number { return a[0] + a[1]; }
function squareRoot(a: Pair): Pair {
  if (a[0] <= 0) return [0, 0];
  const c = Math.sqrt(a[0]), u = product(c, c), low = (a[0] - u[0] - u[1] + a[1]) * .5 / c, high = c + low;
  return [high, c - high + low];
}
function normalize(a: Pair, exponent = 0): Scaled {
  if (a[0] === 0 || !Number.isFinite(a[0])) return { mantissa: a, exponent };
  const shift = Math.max(-1022, Math.min(1023, Math.floor(Math.log2(Math.abs(a[0])))));
  const scale = 2 ** -shift;
  return { mantissa: [a[0] * scale, a[1] * scale], exponent: exponent + shift };
}
function scaleNumber(x: number, exponent: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  if (exponent > 2098) return Math.sign(x) * Infinity;
  if (exponent < -2098) return Math.sign(x) * 0;
  if (exponent > 1023) return x * 2 ** (exponent - 1023) * 2 ** 1023;
  if (exponent < -1022) return x * 2 ** (exponent + 1022) * 2 ** -1022;
  return x * 2 ** exponent;
}
function unscale(a: Scaled): Pair {
  return [scaleNumber(a.mantissa[0], a.exponent), scaleNumber(a.mantissa[1], a.exponent)];
}
function power(a: Pair, b: Pair, host: Pick<FunctionHost, "tick">): Scaled {
  if (value(b) < 0) {
    const positive = power(a, [-b[0], -b[1]], host);
    return { mantissa: divide(one, positive.mantissa), exponent: -positive.exponent };
  }
  let whole = Math.floor(value(b)), fraction = subtract(b, [whole, 0]);
  let result: Scaled = { mantissa: one, exponent: 0 }, base = normalize(a);
  while (whole > 0) {
    host.tick();
    if (whole % 2) {
      result = normalize(multiply(result.mantissa, base.mantissa), result.exponent + base.exponent);
      whole--;
    }
    whole /= 2;
    if (whole) base = normalize(multiply(base.mantissa, base.mantissa), 2 * base.exponent);
  }
  let nearOne = Math.abs(value(a)) >= .5, x = nearOne ? subtract(a, one) : a, factor = one;
  for (let i = 0; i < 1100 && value(fraction) > 0; i++) {
    host.tick();
    const bit = value(fraction); fraction = add(fraction, fraction);
    if (nearOne) {
      const root = subtract(squareRoot(add(x, one)), one), denominator = add(root, one);
      x = divide(add(multiply(root, root), x), add(denominator, denominator));
      if (value(x) === 0) break;
    } else {
      x = squareRoot(x);
      if (value(x) >= .5) { nearOne = true; x = subtract(x, one); }
    }
    if (bit >= .5) {
      fraction = subtract(fraction, one);
      const term = multiply(x, factor); factor = nearOne ? add(factor, term) : term;
    }
  }
  return { mantissa: multiply(result.mantissa, factor), exponent: result.exponent };
}
function gammaError(x: Pair, host: Pick<FunctionHost, "tick">): Pair {
  const numerators = [1, 1, -139, -571, 163879, 5246819, -534703531, -4483131259, 432261921612371];
  const denominators = [12, 288, 51840, 2488320, 209018880, 75246796800, 902961561600, 86684309913600, 514904800886784000];
  let result = one, z = one;
  for (let i = 0; i < numerators.length; i++) {
    host.tick(); z = multiply(z, x);
    result = add(result, divide([numerators[i]!, 0], multiply(z, [denominators[i]!, 0])));
  }
  return result;
}
function log1pmx(x: number, host: Pick<FunctionHost, "tick">): number {
  // Here |x| <= .5/21: the convergent expansion has ample guard precision.
  const r = x / (2 + x), y = r * r;
  let sum = 0;
  for (let k = 40; k >= 1; k--) { host.tick(); sum = fusedMultiplyAdd(sum, y, 2 / (2 * k + 1)); }
  return r * fusedMultiplyAdd(sum, y, -x);
}
function trig(n: number, cosine: boolean, host: Pick<FunctionHost, "tick">): Pair {
  let quadrant = Math.round(2 * n);
  const a = multiply([n - quadrant / 2, 0], pi);
  if (cosine) quadrant++;
  let term = quadrant % 2 ? one : a, result = term;
  const square = multiply(a, a), negativeSquare: Pair = [-square[0], -square[1]];
  for (let i = 1; i < 35; i++) {
    host.tick(); term = divide(multiply(term, negativeSquare), [(2 * i) * (2 * i + (quadrant % 2 ? -1 : 1)), 0]);
    result = add(result, term);
  }
  return quadrant & 2 ? [-result[0], -result[1]] : result;
}
function factorial(x: number, host: Pick<FunctionHost, "tick">): Scaled {
  if (x < -1) {
    const positive = factorial(-x - 1, host);
    return { mantissa: divide(pi, multiply(trig(-x, false, host), positive.mantissa)), exponent: -positive.exponent };
  }
  if (x >= 1073741823) return { mantissa: [Infinity, 0], exponent: 0 };
  if (x >= 9999.5) {
    const y: Pair = [x + 1, 0], powered = power(divide(y, e), y, host);
    return { mantissa: multiply(divide(multiply(squareRoot(add(pi, pi)), powered.mantissa), squareRoot(y)), gammaError(y, host)), exponent: powered.exponent };
  }
  let whole = Math.round(x), qx: Pair = [x, 0], steps = one;
  const fraction = x - whole;
  while (whole < 20) { host.tick(); qx = add(qx, one); whole++; steps = multiply(steps, qx); }
  let integer: Scaled = { mantissa: one, exponent: 0 };
  for (let i = 1; i <= whole; i++) { host.tick(); integer = normalize(multiply(integer.mantissa, [i, 0]), integer.exponent); }
  const xx: Pair = [whole + 1, 0], nn: Pair = [fraction, 0], r = divide(nn, xx), shifted = add(xx, nn);
  const first = unscale(power(e, product(log1pmx(value(r), host), whole + 1), host));
  const second = squareRoot(add(one, r)), third = unscale(power(shifted, nn, host));
  const ratio = divide(multiply(multiply(divide(first, second), third), gammaError(shifted, host)), gammaError(xx, host));
  return normalize(divide(multiply(integer.mantissa, ratio), steps), integer.exponent);
}
function series(x: number, order: number, host: Pick<FunctionHost, "tick">): Pair {
  const powered = power([x / 2, 0], [order, 0], host), fact = factorial(order, host);
  if (fact.mantissa[0] === Infinity) return [0, 0];
  let term = divide(powered.mantissa, fact.mantissa), total = term;
  const square = product(x / 2, x / 2), exponent = powered.exponent - fact.exponent;
  for (let k = 1; k < 200; k++) {
    host.tick(); term = divide(multiply(term, square), multiply([-k, 0], add([order, 0], [k, 0])));
    if (value(term) === 0) break;
    total = add(total, term);
    if (k >= Math.max(5, -order + 5) && Math.abs(value(term)) <= Number.EPSILON / 1048576 * Math.abs(value(total))) break;
  }
  return unscale({ mantissa: total, exponent });
}
function interpolateY(x: number, order: number, nearest: number, host: Pick<FunctionHost, "tick">): number {
  const count = Math.abs(nearest) < 99999 ? 7 : 6;
  const lower = nearest - .001, upper = nearest + .001, middle = (lower + upper) / 2, half = (upper - lower) / 2;
  const normalized = (order - middle) / half, values: number[] = [], coefficients: number[] = [];
  for (let k = 0; k < count; k++) {
    host.tick();
    const node = middle + half * piReduced((k + .5) / count, true);
    values.push(node === Math.floor(node) ? capturedIntegerBesselY(x, node, host) : seriesY(x, node, host));
  }
  for (let j = 0; j < count; j++) {
    let coefficient = 0;
    for (let k = 0; k < count; k++) { host.tick(); coefficient = fusedMultiplyAdd(values[k]!, piReduced(j * (k + .5) / count, true), coefficient); }
    coefficients.push(2 * coefficient / count);
  }
  let previous = 0, current = 0;
  for (let i = count - 1; i >= 1; i--) {
    host.tick(); const next = fusedMultiplyAdd(2 * normalized, current, -previous) + coefficients[i]!;
    previous = current; current = next;
  }
  return fusedMultiplyAdd(.5, coefficients[0]!, fusedMultiplyAdd(normalized, current, -previous));
}
/** Native small-argument J/Y series, with interpolation near integer orders. */
export function capturedBesselSeries(x: number, order: number, secondKind: boolean, host: Pick<FunctionHost, "tick">): number {
  host.tick();
  const nearest = Math.floor(order + .49);
  if (secondKind && Math.abs(order - nearest) <= .0005) return interpolateY(x, order, nearest, host);
  return secondKind ? seriesY(x, order, host) : value(series(x, order, host));
}
function seriesY(x: number, order: number, host: Pick<FunctionHost, "tick">): number {
  const j = series(x, order, host);
  return value(multiply(subtract(multiply(j, trig(order, true, host)), series(x, -order, host)), divide(one, trig(order, false, host))));
}

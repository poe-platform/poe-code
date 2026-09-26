import { fusedMultiplyAdd } from "./numeric-arithmetic.js";
import { scaledPi } from "./reduce-pi.js";
import { sinPi } from "./math.js";
import type { CellValue } from "../../workbook.js";
import { error, numericResult, rendered } from "../values.js";
import { boundedText, collect, numberArg, scalarArg, textArg } from "./common.js";
import type { FunctionHost, FunctionImplementation, SpecialForm } from "./types.js";

export interface Complex { readonly re: number; readonly im: number; readonly unit: string }
export const c = (re: number, im = 0, unit = "i"): Complex => ({ re, im, unit });
export function add(a: Complex, b: Complex): Complex { return c(a.re + b.re, a.im + b.im, b.unit); }
export function negate(a: Complex): Complex { return c(-a.re, -a.im, a.unit); }
export function multiply(a: Complex, b: Complex): Complex { return c(fusedMultiplyAdd(a.re, b.re, -a.im * b.im), fusedMultiplyAdd(a.re, b.im, a.im * b.re), b.unit); }
/** Fixed binary arithmetic belongs to one invocation; iteration work is cancellable. */
function precisionContext(bits: number, host?: Pick<FunctionHost, "tick">) {
  const unit = 1n << BigInt(bits), pi = scaledPi >> BigInt(2048 - bits);
  const multiply = (a: bigint, b: bigint) => a * b / unit;
  const divide = (a: bigint, b: bigint) => a * unit / b;
  const fixed = (x: number): bigint => {
    const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, Math.abs(x));
    const raw = view.getBigUint64(0), exponent = Number(raw >> 52n);
    const mantissa = (raw & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
    const shift = (exponent ? exponent - 1075 : -1074) + bits;
    const value = shift >= 0 ? mantissa << BigInt(shift) : mantissa >> BigInt(-shift);
    return x < 0 ? -value : value;
  };
  const number = (input: bigint, binaryScale = 0): number => {
    const negative = input < 0n, value = negative ? -input : input;
    if (value === 0n) return negative ? -0 : 0;
    const exponent = binaryScale - bits;
    const shift = Math.max(0, value.toString(2).length - 53, -1074 - exponent);
    let mantissa = value >> BigInt(shift);
    if (shift > 0) {
      const dropped = value - (mantissa << BigInt(shift)), half = 1n << BigInt(shift - 1);
      if (dropped > half || dropped === half && (mantissa & 1n) !== 0n) mantissa++;
    }
    const result = Number(mantissa) * 2 ** (exponent + shift);
    return negative ? -result : result;
  };
  const root = (value: bigint): bigint => {
    if (value === 0n) return 0n;
    let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
    for (let step = 0; step < bits + 16; step++) {
      host?.tick(); const next = (estimate + value / estimate) / 2n;
      if (next >= estimate) return estimate;
      estimate = next;
    }
    return estimate;
  };
  const atanRatio = (ratio: bigint): bigint => {
    const reduced = divide(ratio, unit + root(unit * unit + ratio * ratio)), square = multiply(reduced, reduced);
    let term = reduced, sum = reduced;
    for (let n = 1; n <= bits * 2 + 16; n++) {
      host?.tick(); term = -multiply(term, square);
      const contribution = term / BigInt(2 * n + 1);
      if (contribution === 0n) break;
      sum += contribution;
    }
    return 2n * sum;
  };
  const atan2 = (y: bigint, x: bigint): bigint => {
    if (x === 0n) return y < 0n ? -pi / 2n : y > 0n ? pi / 2n : 0n;
    const ax = x < 0n ? -x : x, ay = y < 0n ? -y : y;
    let angle = ax >= ay ? atanRatio(divide(ay, ax)) : pi / 2n - atanRatio(divide(ax, ay));
    if (x < 0n) angle = pi - angle;
    return y < 0n ? -angle : angle;
  };
  const logSeries = (value: bigint): bigint => {
    const ratio = divide(value - unit, value + unit), square = multiply(ratio, ratio);
    let term = ratio, sum = ratio;
    for (let n = 1; n <= bits * 2 + 16; n++) {
      host?.tick(); term = multiply(term, square);
      const contribution = term / BigInt(2 * n + 1);
      if (contribution === 0n) break;
      sum += contribution;
    }
    return 2n * sum;
  };
  let ln2: bigint | undefined;
  const logarithm = (value: bigint): bigint => {
    const exponent = value.toString(2).length - bits - 1;
    const normalized = exponent >= 0 ? value >> BigInt(exponent) : value << BigInt(-exponent);
    ln2 ??= logSeries(2n * unit);
    return logSeries(normalized) + BigInt(exponent) * ln2;
  };
  const exp = (value: bigint): { mantissa: bigint; exponent: number } => {
    ln2 ??= logSeries(2n * unit);
    const exponent = Number(value / ln2);
    if (exponent < -2048) return { mantissa: 0n, exponent: 0 };
    if (!Number.isSafeInteger(exponent) || exponent > 2048) return { mantissa: unit, exponent: 2048 };
    const reduced = value - BigInt(exponent) * ln2;
    let term = unit, sum = unit;
    for (let n = 1; n <= bits * 2 + 16; n++) {
      host?.tick(); term = multiply(term, reduced) / BigInt(n);
      if (term === 0n) break;
      sum += term;
    }
    return { mantissa: sum, exponent };
  };
  const sinCos = (value: bigint, cycles = false): { sin: bigint; cos: bigint } => {
    const quarterTurn = cycles ? unit / 4n : pi / 2n;
    const quadrant = (value + (value < 0n ? -quarterTurn / 2n : quarterTurn / 2n)) / quarterTurn;
    const remainder = value - quadrant * quarterTurn;
    const reduced = cycles ? multiply(remainder, 2n * pi) : remainder, square = multiply(reduced, reduced);
    let sineTerm = reduced, cosineTerm = unit, sine = reduced, cosine = unit;
    for (let n = 1; n <= bits * 2 + 16; n++) {
      host?.tick(); sineTerm = -multiply(sineTerm, square) / BigInt(2 * n * (2 * n + 1));
      cosineTerm = -multiply(cosineTerm, square) / BigInt((2 * n - 1) * 2 * n);
      if (sineTerm === 0n && cosineTerm === 0n) break;
      sine += sineTerm; cosine += cosineTerm;
    }
    switch (Number((quadrant % 4n + 4n) % 4n)) {
      case 0: return { sin: sine, cos: cosine };
      case 1: return { sin: cosine, cos: -sine };
      case 2: return { sin: -sine, cos: -cosine };
      default: return { sin: -cosine, cos: sine };
    }
  };
  const quad = (value: bigint): bigint => {
    const high = number(value), highFixed = fixed(high);
    return highFixed + fixed(number(value - highFixed));
  };
  const quadDivide = (a: bigint, b: bigint): bigint => {
    const ah = number(a), al = number(a - fixed(ah)), bh = number(b), bl = number(b - fixed(bh));
    const quotient = ah / bh, product = quotient * bh, productLow = fusedMultiplyAdd(quotient, bh, -product);
    const residual = ((ah - product) - productLow) + al;
    const low = fusedMultiplyAdd(-quotient, bl, residual) / bh, high = quotient + low;
    return fixed(high) + fixed((quotient - high) + low);
  };
  return { unit, pi, fixed, number, multiply, divide, quad, quadDivide, atan2, logarithm, exp, sinCos };
}
function preciseAtan2(y: number, x: number, host?: Pick<FunctionHost, "tick">): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) return Math.atan2(y, x);
  const bits = Math.min(1536, Math.max(192, 192 - Math.min(binaryExponent(Math.abs(x)), binaryExponent(Math.abs(y)))));
  const context = precisionContext(bits, host);
  return context.number(context.atan2(context.fixed(y), context.fixed(x)));
}
/** Polar power with independent guard precision before one final binary64 rounding. */
export function power(a: Complex, b: Complex, host: Pick<FunctionHost, "tick">): Complex {
  if (!Number.isFinite(a.re) || !Number.isFinite(a.im) || !Number.isFinite(b.re) || !Number.isFinite(b.im)) return c(NaN, NaN, b.unit);
  if (b.im === 0 && a.im === 0 && a.re >= 0) return c(a.re ** b.re, 0, b.unit);
  if (b.im === 0 && b.re === 0) return c(1, 0, b.unit);
  if (b.im === 0 && b.re === 1) return c(a.re, a.im, b.unit);
  if (b.im === 0 && b.re === 2) { const value = multiply(a, a); return c(value.re, value.im, b.unit); }
  if (a.re === 0 && a.im === 0) return c(NaN, NaN, b.unit);
  const inputs = [a.re, a.im, b.re, b.im].filter(x => x !== 0).map(x => binaryExponent(Math.abs(x)));
  const bits = Math.min(1536, Math.max(192, 192 - Math.min(...inputs), 208 + Math.max(...inputs)));
  const ctx = precisionContext(bits, host), ar = ctx.fixed(a.re), ai = ctx.fixed(a.im), br = ctx.fixed(b.re), bi = ctx.fixed(b.im);
  const radiusScale = binaryExponent(Math.max(Math.abs(a.re), Math.abs(a.im)));
  const normalizedRe = ctx.fixed(scaleBinary(a.re, -radiusScale)), normalizedIm = ctx.fixed(scaleBinary(a.im, -radiusScale));
  const radiusSquared = ctx.multiply(normalizedRe, normalizedRe) + ctx.multiply(normalizedIm, normalizedIm);
  const radius = nativeHypot(a.re, a.im);
  // go_quad_pow_frac's sqrt1pm1 Newton numerator adds two copies of the radius.
  if (radius > Number.MAX_VALUE / 2 && b.re !== Math.floor(b.re) && Math.abs(b.re) !== .5) return c(NaN, NaN, b.unit);
  const logRadius = ctx.logarithm(radiusSquared) / 2n + BigInt(radiusScale) * ctx.logarithm(2n * ctx.unit);
  const argumentPi = ctx.quadDivide(ctx.quad(ctx.atan2(ai, ar)), ctx.quad(ctx.pi)), argument = ctx.multiply(argumentPi, ctx.pi);
  const magnitude = ctx.exp(ctx.multiply(br, logRadius) - ctx.multiply(bi, argument));
  const logCycles = ctx.quadDivide(ctx.quad(logRadius), ctx.quad(2n * ctx.pi));
  const cycles = (ctx.multiply(bi, logCycles) + ctx.multiply(br / 2n, argumentPi)) % ctx.unit;
  const trig = ctx.sinCos(cycles, true);
  return c(ctx.number(ctx.multiply(magnitude.mantissa, trig.cos), magnitude.exponent), ctx.number(ctx.multiply(magnitude.mantissa, trig.sin), magnitude.exponent), b.unit);
}

function nativeHypot(x: number, y: number): number {
  const a = Math.abs(x), b = Math.abs(y);
  let large = Math.max(a, b), small = Math.min(a, b);
  if (small <= large * 2 ** -54) return large + small;
  const scale = large > 2 ** 511 ? 2 ** -600 : small < 2 ** -459 ? 2 ** 600 : 1;
  large *= scale; small *= scale;
  const delta = large - small;
  const square = 2 * small >= large ? fusedMultiplyAdd(2 * small, large, delta * delta) : fusedMultiplyAdd(large, large, small * small);
  return Math.sqrt(square) / scale;
}
function scaleBinary(x: number, exponent: number): number {
  while (exponent > 1023) { x *= 2 ** 1023; exponent -= 1023; }
  while (exponent < -1022) { x *= 2 ** -1022; exponent += 1022; }
  return x * 2 ** exponent;
}
function binaryExponent(x: number): number {
  const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, x);
  const e = Number(bits.getBigUint64(0) >> 52n);
  return e === 0 ? Math.floor(Math.log2(x)) + 1 : e - 1022;
}
export function divide(a: Complex, b: Complex): Complex {
  let ar = a.re, ai = a.im, br = b.re, bi = b.im;
  const asize = Math.max(Math.abs(ar), Math.abs(ai)), bsize = Math.max(Math.abs(br), Math.abs(bi));
  if (!Number.isFinite(asize) || !Number.isFinite(bsize) || bsize === 0) return c(NaN, NaN, b.unit);
  if (bi === 0) return c(ar / br, ai / br, b.unit);
  if (br === 0) return c(ai / bi, -ar / bi, b.unit);
  let exponent = 0;
  if (asize + bsize > 1e100 || asize < 1e-100 || bsize < 1e-100) {
    const ea = asize === 0 ? 0 : binaryExponent(asize), eb = binaryExponent(bsize);
    ar = scaleBinary(ar, -ea); ai = scaleBinary(ai, -ea); br = scaleBinary(br, -eb); bi = scaleBinary(bi, -eb);
    exponent = ea - eb;
  }
  const denominator = fusedMultiplyAdd(br, br, bi * bi);
  return c(scaleBinary(fusedMultiplyAdd(ar, br, ai * bi) / denominator, exponent), scaleBinary(fusedMultiplyAdd(ai, br, -ar * bi) / denominator, exponent), b.unit);
}
export function logarithm(z: Complex): Complex {
  const maximum = Math.max(Math.abs(z.re), Math.abs(z.im)), minimum = Math.min(Math.abs(z.re), Math.abs(z.im));
  return c(Math.log(maximum) + Math.log1p((minimum / maximum) ** 2) / 2, Math.atan2(z.im, z.re), z.unit);
}
export function exponential(z: Complex): Complex { const scale = Math.exp(z.re); return c(scale * Math.cos(z.im), scale * Math.sin(z.im), z.unit); }
function squareRoot(z: Complex): Complex {
  if (z.re < 0 && -z.re > Math.abs(z.im)) {
    const root = squareRoot(c(-z.re, -z.im, z.unit));
    return z.im >= 0 ? c(-root.im, root.re, z.unit) : c(root.im, -root.re, z.unit);
  }
  const modulus = nativeHypot(z.re, z.im);
  const magnitude = Number.isFinite(modulus) ? Math.sqrt(modulus) : 2 * Math.sqrt(nativeHypot(z.re / 4, z.im / 4));
  const angle = Math.atan2(z.im, z.re) / Math.PI / 2;
  return c(magnitude * sinPi(.5 - angle), magnitude * sinPi(angle), z.unit);
}
function sine(z: Complex): Complex { return c(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im), z.unit); }
function cosine(z: Complex): Complex { return c(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im), z.unit); }
function sinh(z: Complex): Complex { return c(Math.sinh(z.re) * Math.cos(z.im), Math.cosh(z.re) * Math.sin(z.im), z.unit); }
function cosh(z: Complex): Complex { return c(Math.cosh(z.re) * Math.cos(z.im), Math.sinh(z.re) * Math.sin(z.im), z.unit); }
/** Hull-style crossover formulas used by the pinned Gnumeric GSL implementation. */
function gslInverse(z: Complex): Complex {
  const scale = 1 / nativeHypot(z.re, z.im);
  return c((z.re * scale) * scale, -(z.im * scale) * scale, z.unit);
}
function inverseTrig(z: Complex, cosineMode = false): Complex {
  const R = z.re, I = z.im;
  if (I === 0) {
    if (Math.abs(R) <= 1) return c(cosineMode ? Math.acos(R) : Math.asin(R), 0, z.unit);
    const imaginary = Math.acosh(Math.abs(R));
    return cosineMode ? c(R < 0 ? Math.PI : 0, R < 0 ? -imaginary : imaginary, z.unit) : c(R < 0 ? -Math.PI / 2 : Math.PI / 2, R < 0 ? imaginary : -imaginary, z.unit);
  }
  const x = Math.abs(R), y = Math.abs(I), r = nativeHypot(x + 1, y), t = nativeHypot(x - 1, y);
  const A = .5 * (r + t), B = x / A, y2 = y * y;
  let real: number;
  if (B <= .6417) real = cosineMode ? Math.acos(B) : Math.asin(B);
  else if (x <= 1) {
    const D = .5 * (A + x) * (y2 / (r + x + 1) + (t + (1 - x)));
    real = Math.atan(cosineMode ? Math.sqrt(D) / x : x / Math.sqrt(D));
  } else {
    const Apx = A + x, D = .5 * (Apx / (r + x + 1) + Apx / (t + (x - 1)));
    real = Math.atan(cosineMode ? y * Math.sqrt(D) / x : x / (y * Math.sqrt(D)));
  }
  let imaginary: number;
  if (A <= 1.5) {
    const Am1 = .5 * (y2 / (r + (x + 1)) + (x < 1 ? y2 / (t + (1 - x)) : t + (x - 1)));
    imaginary = Math.log1p(Am1 + Math.sqrt(Am1 * (A + 1)));
  } else imaginary = Math.log(A + Math.sqrt(fusedMultiplyAdd(A, A, -1)));
  return cosineMode ? c(R >= 0 ? real : Math.PI - real, I >= 0 ? -imaginary : imaginary, z.unit) : c(R >= 0 ? real : -real, I >= 0 ? imaginary : -imaginary, z.unit);
}
function atan(z: Complex, host?: Pick<FunctionHost, "tick">): Complex {
  if (z.im === 0) return c(Math.atan(z.re), 0, z.unit);
  const r = nativeHypot(z.re, z.im), u = 2 * z.im / fusedMultiplyAdd(r, r, 1);
  const imaginary = Math.abs(u) < .1 ? .25 * (Math.log1p(u) - Math.log1p(-u)) : .5 * Math.log(nativeHypot(z.re, z.im + 1) / nativeHypot(z.re, z.im - 1));
  const real = z.re === 0 ? z.im > 1 ? Math.PI / 2 : z.im < -1 ? -Math.PI / 2 : 0 : .5 * preciseAtan2(2 * z.re, (1 + r) * (1 - r), host);
  return c(real, imaginary, z.unit);
}
function asinh(z: Complex): Complex { const a = inverseTrig(c(-z.im, z.re, z.unit)); return c(a.im, -a.re, z.unit); }
function acosh(z: Complex): Complex {
  if (z.im === 0 && z.re === 1) return c(0, 0, z.unit);
  const a = inverseTrig(z, true), sign = a.im > 0 ? -1 : 1;
  return c(-sign * a.im, sign * a.re, z.unit);
}
function atanh(z: Complex, host?: Pick<FunctionHost, "tick">): Complex {
  if (z.im === 0) return Math.abs(z.re) < 1 ? c(Math.atanh(z.re), 0, z.unit) : c(Math.abs(z.re) > 2 ? Math.log1p(2 / (z.re - 1)) / 2 : Math.sign(z.re) * Math.log((Math.abs(z.re) - 1) / (Math.abs(z.re) + 1)) / -2, z.re < 0 ? Math.PI / 2 : -Math.PI / 2, z.unit);
  const a = atan(c(-z.im, z.re, z.unit), host); return c(a.im, -a.re, z.unit);
}
function tangent(z: Complex): Complex {
  const sr = Math.sin(z.re), cr = Math.cos(z.re);
  if (Math.abs(z.im) < 1) {
    const sh = Math.sinh(z.im), D = fusedMultiplyAdd(sh, sh, cr * cr);
    return c(sr * cr / D, .5 * Math.sinh(2 * z.im) / D, z.unit);
  }
  const u = Math.exp(-Math.abs(z.im)), C = 2 * u / (1 - u * u), S = C * C, D = 1 + cr * cr * S;
  return c(sr * cr * S / D, (z.im < 0 ? -1 : 1) / Math.tanh(Math.abs(z.im)) / D, z.unit);
}
function hyperbolicTangent(z: Complex): Complex {
  const cosine = Math.cos(z.im), sh = Math.sinh(z.re), D = fusedMultiplyAdd(sh, sh, cosine ** 2);
  return c(Math.abs(z.re) < 1 ? sh * Math.cosh(z.re) / D : 1 / (Math.tanh(z.re) * (1 + (cosine / sh) ** 2)), .5 * Math.sin(2 * z.im) / D, z.unit);
}
function isSpace(code: number): boolean {
  return code >= 9 && code <= 13 || code === 32 || code === 160 || code === 5760 || code >= 8192 && code <= 8202 || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288;
}
export function parse(value: CellValue, host: FunctionHost): Complex | undefined {
  if (value.kind === "number" || value.kind === "boolean") return c(Number(value.value));
  if (value.kind !== "string") return undefined;
  const text = value.value; let offset = 0;
  const space = () => { while (text[offset] !== undefined && isSpace(text.charCodeAt(offset))) offset++; };
  const component = (): number | undefined => {
    host.tick(); space(); let sign = 1;
    if (text[offset] === "+" || text[offset] === "-") { if (text[offset] === "-") sign = -1; offset++; space(); }
    if (text[offset] === "i" || text[offset] === "j") return sign;
    let numericSign = 1;
    if (text[offset] === "+" || text[offset] === "-") { if (text[offset] === "-") numericSign = -1; offset++; }
    const start = offset;
    while (text[offset] !== undefined && text[offset]! >= "0" && text[offset]! <= "9") offset++;
    if (text[offset] === ".") { offset++; while (text[offset] !== undefined && text[offset]! >= "0" && text[offset]! <= "9") offset++; }
    if (start === offset || text.slice(start, offset) === ".") return undefined;
    if (text[offset]?.toLowerCase() === "e") { offset++; if (text[offset] === "+" || text[offset] === "-") offset++; const exponent = offset; while (text[offset] !== undefined && text[offset]! >= "0" && text[offset]! <= "9") offset++; if (offset === exponent) return undefined; }
    const unsigned = numericSign * Number(text.slice(start, offset)), number = sign < 0 ? 0 - unsigned : unsigned; space();
    return Number.isFinite(number) && (number === 0 ? !text.slice(start, offset).split("e")[0]!.split("E")[0]!.split("").some(char => char >= "1" && char <= "9") : Math.abs(number) >= 2 ** -1022) ? number : undefined;
  };
  const first = component(); if (first === undefined) return undefined;
  if (offset === text.length) return c(first);
  if (text[offset] === "i" || text[offset] === "j") { const unit = text[offset++]!; space(); return offset === text.length ? c(0, first, unit) : undefined; }
  if (text[offset] !== "+" && text[offset] !== "-") return undefined;
  const second = component(); if (second === undefined || text[offset] !== "i" && text[offset] !== "j") return undefined;
  const unit = text[offset++]!; space();
  return offset === text.length ? c(first, second, unit) : undefined;
}
export function result(z: Complex, host: FunctionHost): CellValue {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return error("#NUM!");
  if (z.im === 0) return numericResult(z.re);
  const real = z.re === 0 ? "" : rendered(numericResult(z.re));
  const imaginary = z.im === 1 ? real ? "+" : "" : z.im === -1 ? "-" : `${real && z.im > 0 ? "+" : ""}${rendered(numericResult(z.im))}`;
  return boundedText(real + imaginary + z.unit, host);
}
const transforms: Readonly<Record<string, (z: Complex, host?: FunctionHost) => Complex>> = {
  IMCONJUGATE: z => c(z.re, -z.im, z.unit), IMNEG: negate, IMINV: z => divide(c(1), z),
  IMSQRT: squareRoot, IMLN: logarithm, IMEXP: exponential,
  IMLOG10: z => { const a = logarithm(z); return c(a.re * 0.4342944819032518, a.im * 0.4342944819032518, z.unit); },
  IMLOG2: z => { const a = logarithm(z); return c(a.re * (1 / Math.LN2), a.im * (1 / Math.LN2), z.unit); },
  IMSIN: sine, IMCOS: cosine, IMTAN: tangent, IMSEC: z => divide(c(1), cosine(z)),
  IMCSC: z => divide(c(1), sine(z)), IMCOT: z => divide(c(1), tangent(z)),
  IMSINH: sinh, IMCOSH: cosh, IMTANH: hyperbolicTangent, IMSECH: z => gslInverse(cosh(z)),
  IMCSCH: z => gslInverse(sinh(z)), IMCOTH: z => gslInverse(hyperbolicTangent(z)),
  IMARCSIN: z => inverseTrig(z), IMARCCOS: z => inverseTrig(z, true), IMARCTAN: atan, IMARCSINH: asinh, IMARCCOSH: acosh, IMARCTANH: atanh,
  IMARCSEC: z => inverseTrig(gslInverse(z), true), IMARCCSC: z => inverseTrig(gslInverse(z)), IMARCCOT: (z, host) => z.re === 0 && z.im === 0 ? c(Math.PI / 2, 0, z.unit) : atan(gslInverse(z), host),
  IMARCSECH: z => acosh(gslInverse(z)), IMARCCSCH: z => asinh(gslInverse(z)), IMARCCOTH: (z, host) => atanh(gslInverse(z), host)
};
export const complexFunctions: Readonly<Record<string, FunctionImplementation>> = {
  COMPLEX: (args, host) => {
    const unit = args[2] === undefined ? "i" : textArg(args, 2, host);
    return unit !== "i" && unit !== "j" ? error("#VALUE!") : result(c(numberArg(args, 0, host), numberArg(args, 1, host), unit), host);
  },
  ...Object.fromEntries(Object.entries(transforms).map(([name, fn]) => [name, ((args, host) => {
    const z = parse(scalarArg(args, 0, host), host);
    return z ? result(fn(z, host), host) : error("#NUM!");
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["IMREAL", "IMAGINARY", "IMABS", "IMARGUMENT"].map(name => [name, ((args, host) => {
    const original = scalarArg(args, 0, host);
    if (name === "IMREAL" && (original.kind === "number" || original.kind === "boolean")) return original;
    const z = parse(original, host);
    return z ? numericResult(name === "IMREAL" ? z.re : name === "IMAGINARY" ? z.im : name === "IMABS" ? nativeHypot(z.re, z.im) : Math.atan2(z.im, z.re)) : error("#NUM!");
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["IMSUB", "IMDIV", "IMPOWER"].map(name => [name, ((args, host) => {
    const a = parse(scalarArg(args, 0, host), host), b = parse(scalarArg(args, 1, host), host);
    if (!a || !b) return error("#NUM!");
    if (name === "IMSUB") return result(add(a, negate(b)), host);
    if (name === "IMDIV") return b.re === 0 && b.im === 0 ? error("#DIV/0!") : result(divide(a, b), host);
    if (a.re === 0 && a.im === 0 && b.re === 0 && b.im === 0) return error("#DIV/0!");
    return result(power(a, b, host), host);
  }) satisfies FunctionImplementation]))
};
export const complexSpecialForms: Readonly<Record<string, SpecialForm>> = Object.fromEntries(["IMSUM", "IMPRODUCT"].map(name => [name, ((nodes, host) => {
  let acc = c(name === "IMSUM" ? 0 : 1, 0, "j"), unit = "j";
  for (const node of nodes) for (const cell of collect(host.evaluate(node, true), host)) {
    if (cell.kind === "error") return cell;
    if (cell.kind === "blank") continue;
    const z = parse(cell, host); if (!z) return error("#NUM!");
    if (cell.kind === "string") unit = z.unit;
    acc = name === "IMSUM" ? add(acc, z) : multiply(acc, z);
  }
  return result(c(acc.re, acc.im, unit), host);
}) satisfies SpecialForm]));

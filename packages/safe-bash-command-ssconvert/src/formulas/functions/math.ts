import { error, numericResult, product, sum } from "../values.js";
import { collect, numberArg } from "./common.js";
import { fakeFloor, fakeTrunc, nextAfter } from "./floating-point.js";
import { gamma } from "./scientific.js";
import { capturedTrig } from "./captured-trigonometry.js";
import { capturedExp } from "./numeric-arithmetic.js";
import { preciseLog1p } from "./log1p.js";
import type { FunctionHost, FunctionImplementation, SpecialForm } from "./types.js";

function fakeCeil(x: number): number { return x === Math.floor(x) ? x : Math.ceil(nextAfter(x, -Infinity)); }
function fakeRound(x: number): number { return x === Math.floor(x) ? x : Math.sign(x) * fakeFloor(Math.abs(x) + .5); }
function digitRound(x: number, digits: number, mode: string): number {
  if (x === 0) return x;
  digits = Math.trunc(Math.max(-2147483647, Math.min(2147483647, digits)));
  const rounding = mode === "ROUND" ? fakeRound : mode === "ROUNDUP" ? (n: number) => n < 0 ? -fakeCeil(-n) : fakeCeil(n) : fakeTrunc;
  if (digits >= 0) {
    // A binary rational terminates after at most this many decimal places.
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, Math.abs(x));
    const raw = bits.getBigUint64(0), exponent = Number(raw >> 52n);
    let mantissa = raw & ((1n << 52n) - 1n);
    if (exponent !== 0) mantissa |= 1n << 52n;
    let fractionalPlaces = exponent === 0 ? 1074 : 1075 - exponent;
    while (mantissa !== 0n && (mantissa & 1n) === 0n) { mantissa >>= 1n; fractionalPlaces--; }
    const abs = Math.abs(x);
    let decimalExponent = Math.floor(Math.log10(abs));
    if (10 ** decimalExponent > abs) decimalExponent--;
    else if (10 ** (decimalExponent + 1) <= abs) decimalExponent++;
    const leadingZeros = abs >= 1 ? 0 : -decimalExponent - 1;
    if (digits >= fractionalPlaces || digits >= leadingZeros + 17) return x;
    // Gnumeric splits large decimal powers at 303 to reduce representation error.
    const first = 10 ** (digits <= 308 ? digits : digits - 303), second = digits <= 308 ? 1 : 1e303, scaled = x * second * first;
    return Number.isFinite(scaled) ? rounding(scaled) / second / first : x;
  }
  if (digits < -308) return mode === "ROUNDUP" || mode === "ROUND" && digits === -309 && Math.abs(x) >= 5 * 10 ** 308 ? Math.sign(x) * Infinity : 0;
  const power = 10 ** -digits;
  return rounding(x / power) * power;
}
/** GOffice quadrant reduction keeps the pi multiplication within a quarter turn. */
export function piReduced(x: number, cosine: boolean): number {
  if (!Number.isFinite(x)) return NaN;
  const negative = x < 0;
  let r = Math.abs(x) % 2, quadrant = 0;
  if (r >= 1) { r -= 1; quadrant += 2; }
  if (r >= .5) { r -= .5; quadrant++; }
  if (r > .25) { r -= .5; quadrant++; }
  if (negative) {
    r = -r; quadrant = 4 - quadrant;
    if (r === -.25) { r += .5; quadrant += 3; }
  }
  if (!cosine && r === 0 && (quadrant & 1) === 0) return negative || Object.is(x, -0) ? -0 : 0;
  if (cosine && r === 0 && (quadrant & 1) === 1) return 0;
  if (cosine) quadrant++;
  const y = r === 0 ? quadrant & 1 : r === .25 ? 0.7071067811865476 : capturedTrig(Math.PI * r, (quadrant & 1) !== 0);
  return quadrant & 2 ? 0 - y : y;
}
export function sinPi(x: number): number { return piReduced(x, false); }
/** Exact binary rational components, including the virtual successor of FLT.MAX. */
function binaryParts(x: number): { mantissa: bigint; exponent: number } {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x);
  const bits = view.getBigUint64(0), exponent = Number(bits >> 52n);
  return { mantissa: (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n),
    exponent: exponent ? exponent - 1075 : -1074 };
}
/** Correct the library estimate by comparing exact squares at rounding midpoints. */
export function preciseHypot(x: number, y: number, host?: Pick<FunctionHost, "tick">): number {
  x = Math.abs(x); y = Math.abs(y);
  if (x === 0) return y; if (y === 0) return x;
  let result = Math.hypot(x, y);
  if (!Number.isFinite(result)) return result;
  const a = binaryParts(x), b = binaryParts(y), exponent = 2 * Math.min(a.exponent, b.exponent);
  const square = (a.mantissa * a.mantissa << BigInt(2 * a.exponent - exponent)) +
    (b.mantissa * b.mantissa << BigInt(2 * b.exponent - exponent));
  for (let attempt = 0; attempt < 4; attempt++) {
    host?.tick();
    const center = binaryParts(result);
    let corrected = false;
    for (const direction of [-Infinity, Infinity]) {
      const neighbor = nextAfter(result, direction), edge = binaryParts(neighbor);
      const e = Math.min(center.exponent, edge.exponent);
      const midpoint = (center.mantissa << BigInt(center.exponent - e)) + (edge.mantissa << BigInt(edge.exponent - e));
      const midpointExponent = 2 * e - 2, common = Math.min(exponent, midpointExponent);
      const lhs = square << BigInt(exponent - common), rhs = midpoint * midpoint << BigInt(midpointExponent - common);
      if ((direction < 0 ? lhs < rhs : lhs > rhs) || lhs === rhs && (center.mantissa & 1n) !== 0n) {
        result = neighbor; corrected = true; break;
      }
    }
    if (!corrected || !Number.isFinite(result)) return result;
  }
  return result;
}
const unary: Readonly<Record<string, (x: number) => number>> = {
  ABS: Math.abs, SIGN: Math.sign, SQRT: Math.sqrt, SQRTPI: x => Math.sqrt(Math.PI * x),
  INT: fakeFloor, CEIL: fakeCeil, SIN: Math.sin, COS: Math.cos, TAN: Math.tan,
  ASIN: Math.asin, ACOS: Math.acos, ATAN: Math.atan, ACOT: x => Math.atan(1 / x),
  SINH: Math.sinh, COSH: Math.cosh, TANH: Math.tanh, ASINH: Math.asinh, ACOSH: Math.acosh,
  ATANH: x => Math.abs(x) >= 1 ? NaN : Math.atanh(x), ACOTH: x => Math.abs(x) <= 1 ? NaN : Math.abs(x) > 2 ? Math.log1p(2 / (x - 1)) / 2 : Math.sign(x) * Math.log((Math.abs(x) - 1) / (Math.abs(x) + 1)) / -2,
  SEC: x => 1 / Math.cos(x), CSC: x => 1 / Math.sin(x), COT: x => 1 / Math.tan(x),
  SECH: x => 1 / Math.cosh(x), CSCH: x => 1 / Math.sinh(x), COTH: x => 1 / Math.tanh(x),
  EXP: capturedExp, EXPM1: Math.expm1, LN: x => x > 0 ? Math.log(x) : NaN,
  LOG10: x => x > 0 ? Math.log10(x) : NaN,
  LOG2: x => x > 0 ? Math.log2(x) : NaN,
  DEGREES: x => x * 180 / Math.PI, RADIANS: x => x * Math.PI / 180, GD: x => 2 * Math.atan(Math.tanh(x / 2)),
  SINPI: sinPi, COSPI: x => piReduced(x, true), TANPI: x => sinPi(x) / piReduced(x, true), COTPI: x => piReduced(x, true) / sinPi(x),
  EVEN: x => {
    const integer = x >= 0 ? Math.ceil(x) : Math.floor(x);
    return integer % 2 !== 0 ? integer + (x >= 0 ? 1 : -1) : integer;
  },
  ODD: x => {
    const integer = x >= 0 ? Math.ceil(x) : Math.floor(x);
    return integer % 2 === 0 ? integer + (x >= 0 ? 1 : -1) : integer;
  }
};
function binomial(n: number, k: number, host: FunctionHost): number {
  n = Math.floor(n); k = Math.floor(k);
  if (n < 0 || k < 0 || k > n) return NaN;
  k = Math.min(k, n - k);
  if (!Number.isFinite(n) || !Number.isFinite(k)) return NaN;
  // The coefficient is integral; retain it exactly until its final binary rounding.
  const integerN = BigInt(n);
  let result = 1n;
  for (let i = 1; i <= k; i++) {
    host.tick();
    result = result * (integerN - BigInt(i) + 1n) / BigInt(i);
    if (!Number.isFinite(Number(result))) return Infinity;
  }
  return Number(result);
}
export const mathFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ...Object.fromEntries(Object.entries(unary).map(([name, fn]) => [name, ((args, host) => numericResult(fn(numberArg(args, 0, host)))) satisfies FunctionImplementation])),
  LN1P: (args, host) => numericResult(preciseLog1p(numberArg(args, 0, host), host)),
  PI: () => numericResult(Math.PI),
  ATAN2: (args, host) => {
    const x = numberArg(args, 0, host), y = numberArg(args, 1, host);
    return x === 0 && y === 0 ? error("#DIV/0!") : numericResult(Math.atan2(y, x));
  },
  POWER: (args, host) => {
    const x = numberArg(args, 0, host), y = numberArg(args, 1, host), z = numberArg(args, 2, host, 1);
    if (x === 0 && y <= 0) return error(y === 0 ? "#NUM!" : "#DIV/0!");
    if (x < 0 && y !== Math.floor(y)) return error("#NUM!");
    let result = x ** y;
    if (z <= 0 || z !== Math.floor(z) || result < 0 && z % 2 === 0) return error("#NUM!");
    if (z === 3) result = Math.cbrt(result);
    else if (z !== 1) result = Math.sign(result) * Math.abs(result) ** (1 / z);
    return numericResult(result);
  },
  ...Object.fromEntries(["FLOOR", "CEILING"].map(name => [name, ((args, host) => {
    const x = numberArg(args, 0, host), s = numberArg(args, 1, host, x > 0 ? 1 : -1);
    if (x === 0 || name === "CEILING" && s === 0) return numericResult(0);
    if (s === 0) return error("#DIV/0!");
    return x > 0 && s < 0 ? error("#NUM!") : numericResult((name === "FLOOR" ? fakeFloor : fakeCeil)(x / s) * s);
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["ROUND", "ROUNDUP", "ROUNDDOWN", "TRUNC"].map(name => [name, ((args, host) =>
    numericResult(digitRound(numberArg(args, 0, host), numberArg(args, 1, host), name))) satisfies FunctionImplementation])),
  MOD: (args, host) => {
    const x = numberArg(args, 0, host), y = numberArg(args, 1, host);
    if (y === 0) return error("#DIV/0!");
    let result = Math.abs(x) % Math.abs(y);
    if (result > 0) { if ((x < 0) !== (y < 0)) result = Math.abs(y) - result; if (y < 0) result = -result; }
    return numericResult(result);
  },
  QUOTIENT: (args, host) => {
    const y = numberArg(args, 1, host);
    return y === 0 ? error("#DIV/0!") : numericResult(fakeTrunc(numberArg(args, 0, host) / y));
  },
  MROUND: (args, host) => {
    const x = numberArg(args, 0, host), m = numberArg(args, 1, host);
    if (m === 0) return numericResult(0);
    if ((x > 0 && m < 0) || (x < 0 && m > 0)) return error("#NUM!");
    const positiveX = Math.abs(x), positiveM = Math.abs(m), remainder = positiveX % positiveM;
    return numericResult((x < 0 ? -1 : 1) * ((remainder >= positiveM / 2 ? positiveM : 0) + (positiveX - remainder)));
  },
  LOG: (args, host) => {
    const x = numberArg(args, 0, host), base = numberArg(args, 1, host, 10);
    return x <= 0 || base <= 0 || base === 1 ? error("#NUM!") : numericResult(base === 10 ? Math.log10(x) : base === 2 ? Math.log2(x) : Math.log(x) / Math.log(base));
  },
  ILOG: (args, host) => {
    const x = numberArg(args, 0, host), base = numberArg(args, 1, host, 10);
    if (x <= 0 || base <= 0 || base === 1) return error("#NUM!");
    const radix = binaryParts(base);
    if (base >= 2 && radix.mantissa === 1n << 52n) {
      const value = binaryParts(x);
      // Released gnm_ilog divides integer binary exponents using C truncation.
      const exponent = value.exponent + value.mantissa.toString(2).length - 1;
      return numericResult(Math.trunc(exponent / (radix.exponent + 52)));
    }
    let result = Math.floor(Math.log(x) / Math.log(base));
    // Correct quotient rounding at exact powers and adjacent values.
    if (base > 1) { if (base ** result > x) result--; else if (base ** (result + 1) <= x) result++; }
    else { if (base ** result < x) result--; else if (base ** (result + 1) >= x) result++; }
    return numericResult(result);
  },
  ...Object.fromEntries(["FACT", "FACTDOUBLE"].map(name => [name, ((args, host) => {
    const x = numberArg(args, 0, host), n = name === "FACT" ? fakeFloor(x) : Math.trunc(x);
    if (name === "FACT" && x !== Math.floor(x)) return numericResult(gamma(x + 1, host));
    if (x < 0) return error("#NUM!");
    if (n > (name === "FACT" ? 170 : 300)) return error("#NUM!");
    let result = 1n;
    for (let i = n; i > 1; i -= name === "FACT" ? 1 : 2) { host.tick(); result *= BigInt(i); }
    return numericResult(Number(result));
  }) satisfies FunctionImplementation])),
  COMBIN: (args, host) => numericResult(binomial(numberArg(args, 0, host), numberArg(args, 1, host), host)),
  COMBINA: (args, host) => {
    const n = Math.floor(numberArg(args, 0, host)), k = Math.floor(numberArg(args, 1, host));
    return n < 0 || k < 0 ? error("#NUM!") : numericResult(binomial(n + k - 1, k, host));
  },
  FIB: (args, host) => {
    const n = Math.floor(numberArg(args, 0, host));
    if (n < 1) return error("#NUM!");
    if (n >= 47) {
      const root = Math.sqrt(5);
      return numericResult((((1 + root) / 2) ** n - ((1 - root) / 2) ** n) / root);
    }
    let a = 0, b = 1;
    for (let i = 0; i < n; i++) { host.tick(); const next = a + b; a = b; b = next; }
    return numericResult(a);
  },
  AGM: (args, host) => {
    let a = numberArg(args, 0, host), b = numberArg(args, 1, host);
    if (a < 0 || b < 0) return error("#NUM!");
    if (a === b) return numericResult(a);
    if (a === 0 || b === 0) return numericResult(0);
    let scale = 1;
    if (a * b === 0 || !Number.isFinite(a * b)) {
      const exponent = (x: number) => {
        const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x);
        const e = Number(view.getBigUint64(0) >> 52n);
        return e === 0 ? Math.floor(Math.log2(x)) + 1 : e - 1022;
      };
      scale = 2 ** Math.trunc(-(exponent(a) + exponent(b)) / 2);
      a *= scale; b *= scale;
    }
    for (let i = 1; i < 20; i++) {
      host.tick();
      const mean = (a + b) / 2, geometric = Math.sqrt(a * b);
      a = mean; b = geometric;
      if (Math.abs(a - b) < a * Number.EPSILON) break;
    }
    return numericResult(a / scale);
  },
  SERIESSUM: (args, host) => {
    const x = numberArg(args, 0, host), n = numberArg(args, 1, host), step = numberArg(args, 2, host);
    const coefficients = collect(args[3]!, host), terms: number[] = [];
    for (let i = 0; i < coefficients.length; i++) { host.tick(); const cell = coefficients[i]!; if (cell.kind === "error") return cell; if (cell.kind !== "number") return error("#VALUE!"); terms.push(cell.value * x ** (n + i * step)); }
    return numericResult(sum(terms, host.tick));
  },
  ...Object.fromEntries(["SUMX2MY2", "SUMX2PY2", "SUMXMY2"].map(name => [name, ((args, host) => {
    const a = collect(args[0]!, host), b = collect(args[1]!, host);
    if (a.length !== b.length) return error("#N/A");
    const terms: number[] = [];
    for (let i = 0; i < a.length; i++) { host.tick(); const x = a[i]!, y = b[i]!; if (x.kind === "error") return x; if (y.kind === "error") return y; if (x.kind !== "number" || y.kind !== "number") continue; terms.push(name === "SUMXMY2" ? (x.value - y.value) ** 2 : x.value ** 2 + (name === "SUMX2MY2" ? -1 : 1) * y.value ** 2); }
    return numericResult(sum(terms, host.tick));
  }) satisfies FunctionImplementation]))
};
export const mathSpecialForms: Readonly<Record<string, SpecialForm>> = {
  ...Object.fromEntries(["GCD", "LCM", "MULTINOMIAL", "SUMSQ", "SUMA", "HYPOT", "G_PRODUCT"].map(name => [name, ((nodes, host) => {
    const values: number[] = [];
    for (const node of nodes) for (const cell of collect(host.evaluate(node, true), host)) {
      if (cell.kind === "error") return cell;
      if (cell.kind === "number") values.push(cell.value);
      else if (name === "SUMA") values.push(cell.kind === "boolean" ? Number(cell.value) : 0);
    }
    if (name === "SUMA") return numericResult(sum(values, host.tick));
    if (name === "SUMSQ") return numericResult(sum(values.map(x => x * x), host.tick));
    if (name === "G_PRODUCT") return numericResult(product(values));
    if (name === "HYPOT") {
      let first = 0, last = values.length;
      while (first < last && values[first] === 0) first++;
      while (last > first && values[last - 1] === 0) last--;
      if (last === first) return numericResult(0);
      if (last - first === 1) return numericResult(Math.abs(values[first]!));
      if (last - first === 2) return numericResult(preciseHypot(values[first]!, values[first + 1]!, host));
      return numericResult(Math.sqrt(sum(values.slice(first, last).map(x => x * x), host.tick)));
    }
    if (!values.length) return error("#NUM!");
    if (name === "MULTINOMIAL" && values.some(x => x < 0)) return error("#NUM!");
    if (name === "MULTINOMIAL") {
      let total = 0, result = 1;
      for (const x of values) { host.tick(); const n = fakeFloor(x); total += n; result *= binomial(total, n, host); }
      return numericResult(result);
    }
    let result = name === "GCD" ? 0n : 1n;
    for (const value of values) {
      host.tick();
      const integer = fakeFloor(value);
      if (integer < 0 || integer > 2 ** 52 || name === "LCM" && (integer < 1 || result > 2n ** 52n)) return error("#NUM!");
      const x = BigInt(integer); let a = result, b = x;
      while (b) { host.tick(); const remainder = a % b; a = b; b = remainder; }
      result = name === "GCD" ? a : a === 0n ? 0n : result / a * x;
    }
    return name === "GCD" && result === 0n ? error("#NUM!") : numericResult(Number(result));
  }) satisfies SpecialForm])),
  ...Object.fromEntries(["SUMPRODUCT", "ODF.SUMPRODUCT"].map(name => [name, ((nodes, host) => {
    if (!nodes.length) return error("#VALUE!");
    const matrices = nodes.map(node => host.matrix(host.evaluate(node, true)));
    const height = matrices[0]!.rows.length, width = matrices[0]!.rows[0]?.length ?? 0;
    if (matrices.some(m => m.rows.length !== height || m.rows.some(row => row.length !== width))) return error("#VALUE!");
    const terms: number[] = [];
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
      let term = 1;
      for (const matrix of matrices) { host.tick(); const cell = matrix.rows[row]![column]!; if (cell.kind === "error") return cell; term *= cell.kind === "number" ? cell.value : name === "ODF.SUMPRODUCT" && cell.kind === "boolean" ? Number(cell.value) : 0; }
      terms.push(term);
    }
    return numericResult(sum(terms, host.tick));
  }) satisfies SpecialForm]))
};

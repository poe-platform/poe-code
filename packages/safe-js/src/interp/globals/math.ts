import { createSandboxClosure, type SandboxObject } from "../values.js";

const mathMethods = {
  abs: Math.abs,
  acos: Math.acos,
  acosh: Math.acosh,
  asin: Math.asin,
  asinh: Math.asinh,
  atan: Math.atan,
  atan2: Math.atan2,
  atanh: Math.atanh,
  ceil: Math.ceil,
  cbrt: Math.cbrt,
  clz32: Math.clz32,
  cos: Math.cos,
  cosh: Math.cosh,
  exp: Math.exp,
  expm1: Math.expm1,
  floor: Math.floor,
  f16round,
  fround: Math.fround,
  hypot: Math.hypot,
  imul: Math.imul,
  log: Math.log,
  log1p: Math.log1p,
  log10: Math.log10,
  log2: Math.log2,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sinh: Math.sinh,
  sqrt: Math.sqrt,
  tan: Math.tan,
  tanh: Math.tanh,
  trunc: Math.trunc
} satisfies Record<string, (...args: number[]) => number>;

function f16round(value: number): number {
  const number = +value;
  if (!Number.isFinite(number) || number === 0) {
    return number;
  }

  const magnitude = Math.abs(number);
  if (magnitude >= 65520) {
    return number < 0 ? -Infinity : Infinity;
  }

  let quantum = 2 ** -24;
  let boundary = 2 ** -13;
  for (let exponent = -13; exponent <= 15 && magnitude >= boundary; exponent += 1) {
    quantum *= 2;
    boundary *= 2;
  }

  const scaled = magnitude / quantum;
  const lower = Math.floor(scaled);
  const remainder = scaled - lower;
  const rounded =
    (remainder > 0.5 || (remainder === 0.5 && lower % 2 !== 0) ? lower + 1 : lower) * quantum;
  return number < 0 ? -rounded : rounded;
}

export type SeededRandom = {
  next: () => number;
  restore: (state: number) => void;
  snapshot: () => number;
};

export type MathGlobalsOptions = {
  random?: () => number;
};

export type MathGlobals = {
  Infinity: number;
  Math: SandboxObject;
  NaN: number;
};

export function createMathGlobals(options: MathGlobalsOptions = {}): MathGlobals {
  const random = options.random ?? Math.random;
  const mathObject: SandboxObject = {
    E: Math.E,
    LN2: Math.LN2,
    LN10: Math.LN10,
    LOG2E: Math.LOG2E,
    LOG10E: Math.LOG10E,
    PI: Math.PI,
    SQRT1_2: Math.SQRT1_2,
    SQRT2: Math.SQRT2,
    random: createSandboxClosure({ sandbox: true, call: () => random(), name: "random" })
  };

  for (const [name, method] of Object.entries(mathMethods)) {
    mathObject[name] = createSandboxClosure({
      sandbox: true,
      call: (args) => Reflect.apply(method, Math, args as number[]),
      name
    });
  }

  return {
    Infinity,
    Math: mathObject,
    NaN: Number.NaN
  };
}

export function createSeededRandom(seed: number): SeededRandom {
  let state = normalizeSeed(seed);

  return {
    next: () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 4_294_967_296;
    },
    snapshot: () => state,
    restore: (nextState) => {
      state = normalizeSeed(nextState);
    }
  };
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new TypeError("Seeded random requires a finite numeric seed.");
  }

  return Math.trunc(seed) >>> 0;
}

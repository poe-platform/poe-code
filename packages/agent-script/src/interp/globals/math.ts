import { createSandboxClosure, type SandboxObject } from "../values.js";

const mathMethods = {
  abs: Math.abs,
  ceil: Math.ceil,
  cbrt: Math.cbrt,
  cos: Math.cos,
  exp: Math.exp,
  floor: Math.floor,
  hypot: Math.hypot,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
  trunc: Math.trunc
} satisfies Record<string, (...args: number[]) => number>;

export type SeededRandom = {
  next: () => number;
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
    PI: Math.PI,
    random: createSandboxClosure({
      call: () => random(),
      name: "random"
    })
  };

  for (const [name, method] of Object.entries(mathMethods)) {
    mathObject[name] = createSandboxClosure({
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
    snapshot: () => state
  };
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new TypeError("Seeded random requires a finite numeric seed.");
  }

  return Math.trunc(seed) >>> 0;
}

export const unaryMath: Readonly<Record<string, (value: number) => number>> = Object.freeze({
  log: Math.log, log2: Math.log2, log10: Math.log10, log1p: Math.log1p,
  exp: Math.exp, exp2: value => 2 ** value, exp10: value => 10 ** value, expm1: Math.expm1,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  cbrt: Math.cbrt, trunc: Math.trunc,
});

export const binaryMath: Readonly<Record<string, (left: number, right: number) => number>> = Object.freeze({
  pow: Math.pow, atan2: Math.atan2, hypot: Math.hypot,
  fmin: (left, right) => Number.isNaN(left) ? right : Number.isNaN(right) ? left : Math.min(left, right),
  fmax: (left, right) => Number.isNaN(left) ? right : Number.isNaN(right) ? left : Math.max(left, right),
  fmod: (left, right) => left % right,
});

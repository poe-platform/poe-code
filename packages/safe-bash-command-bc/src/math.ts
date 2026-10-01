interface DecimalValue {
  readonly coeff: bigint;
  readonly scale: number;
}

type Tick = () => Promise<void> | undefined;
const abs = (x: bigint): bigint => x < 0n ? -x : x;

// Fixed-point series with guard digits. All iteration participates in the caller's
// work budget and cooperative cancellation; no process-global precision or tables.
export async function mathValue(name: string, args: readonly DecimalValue[], scale: number, tick: Tick): Promise<DecimalValue | undefined> {
  if (!["s", "c", "a", "l", "e", "j"].includes(name)) return undefined;
  const raw = args[name === "j" ? 1 : 0] ?? { coeff: 0n, scale: 0 };
  const pending = tick(); if (pending) await pending;
  // e^-x < 10^-scale for x > 3*(scale+1); avoid constructing a huge
  // positive exponential only to discard its reciprocal.
  if (name === "e" && raw.coeff < 0n && abs(raw.coeff) > BigInt(scale + 1) * 3n * (10n ** BigInt(raw.scale))) {
    return { coeff: 0n, scale };
  }
  const integer = abs(raw.coeff) / (10n ** BigInt(raw.scale));
  // exp and Bessel need guard digits for integer growth and cancellation;
  // trig needs enough pi digits to reduce the entire integer argument.
  const extra = name === "e" || name === "j" ? Number(integer) + 1 : integer.toString().length;
  // Preserve the cubic correction in sin/atan/Bessel even for tiny inputs:
  // dropping it can turn truncation just below a decimal boundary into equality.
  const precision = scale + Math.max(extra, 3 * raw.scale) + 32;
  for (let digits = 0; digits < precision; digits += 64) {
    const pending = tick(); if (pending) await pending;
  }
  const unit = 10n ** BigInt(precision);
  const mul = (a: bigint, b: bigint) => a * b / unit;
  const div = (a: bigint, b: bigint) => a * unit / b;
  const x = raw.coeff * unit / (10n ** BigInt(raw.scale));
  if (name === "e" && raw.coeff < 0n && x === 0n) {
    return { coeff: 10n ** BigInt(scale) - 1n, scale };
  }

  async function sqrt(value: bigint): Promise<bigint> {
    const target = value * unit;
    let guess = 1n << BigInt(Math.ceil(target.toString(2).length / 2));
    while (true) {
      const pending = tick(); if (pending) await pending;
      const next = (guess + target / guess) / 2n;
      if (next >= guess) return guess;
      guess = next;
    }
  }

  async function atan(value: bigint): Promise<bigint> {
    const negative = value < 0n;
    let reduced = abs(value);
    const reciprocal = reduced > unit;
    if (reciprocal) reduced = div(unit, reduced);
    let doubles = 0;
    while (reduced > unit / 4n) {
      const pending = tick(); if (pending) await pending;
      reduced = div(reduced, unit + await sqrt(unit + mul(reduced, reduced)));
      doubles++;
    }
    const square = -mul(reduced, reduced);
    let power = reduced;
    let sum = reduced;
    for (let k = 3n; power !== 0n; k += 2n) {
      const pending = tick(); if (pending) await pending;
      power = mul(power, square);
      const term = power / k;
      if (term === 0n) break;
      sum += term;
    }
    sum *= 2n ** BigInt(doubles);
    if (reciprocal) sum = (await pi()) / 2n - sum;
    return negative ? -sum : sum;
  }

  async function pi(): Promise<bigint> {
    return 16n * await atan(unit / 5n) - 4n * await atan(unit / 239n);
  }

  async function logSeries(value: bigint): Promise<bigint> {
    const z = div(value - unit, value + unit);
    const square = mul(z, z);
    let power = z;
    let sum = z;
    for (let k = 3n; power !== 0n; k += 2n) {
      const pending = tick(); if (pending) await pending;
      power = mul(power, square);
      const term = power / k;
      if (term === 0n) break;
      sum += term;
    }
    return 2n * sum;
  }

  let result: bigint;
  switch (name) {
    case "a": result = await atan(x); break;
    case "l": {
      if (raw.coeff <= 0n) throw new Error("Runtime error: l(x) domain error");
      // Normalize the exact input before fixed-point conversion, including inputs
      // much smaller than the requested output precision.
      let numerator = raw.coeff;
      let denominator = 10n ** BigInt(raw.scale);
      let shifts = 0n;
      while (numerator >= 2n * denominator) {
        const pending = tick(); if (pending) await pending;
        denominator *= 2n;
        shifts++;
      }
      while (numerator < denominator) {
        const pending = tick(); if (pending) await pending;
        numerator *= 2n;
        shifts--;
      }
      result = await logSeries(numerator * unit / denominator);
      if (shifts !== 0n) result += shifts * await logSeries(2n * unit);
      break;
    }
    case "e": {
      let reduced = abs(x);
      let squares = 0;
      while (reduced > unit / 2n) {
        const pending = tick(); if (pending) await pending;
        reduced /= 2n;
        squares++;
      }
      let term = unit;
      result = unit;
      for (let k = 1n; term !== 0n; k++) {
        const pending = tick(); if (pending) await pending;
        term = mul(term, reduced) / k;
        result += term;
      }
      for (let k = 0; k < squares; k++) {
        const pending = tick(); if (pending) await pending;
        result = mul(result, result);
      }
      if (x < 0n) result = div(unit, result);
      break;
    }
    case "s":
    case "c": {
      const circle = 2n * await pi();
      let reduced = x % circle;
      if (reduced > circle / 2n) reduced -= circle;
      if (reduced < -circle / 2n) reduced += circle;
      const square = -mul(reduced, reduced);
      let term = name === "s" ? reduced : unit;
      result = term;
      for (let k = name === "s" ? 2n : 1n; term !== 0n; k += 2n) {
        const pending = tick(); if (pending) await pending;
        term = mul(term, square) / (k * (k + 1n));
        result += term;
      }
      break;
    }
    default: {
      const orderValue = args[0] ?? { coeff: 0n, scale: 0 };
      const n = orderValue.coeff / (10n ** BigInt(orderValue.scale));
      const order = abs(n);
      const half = x / 2n;
      let term = unit;
      for (let i = 1n; i <= order; i++) {
        const pending = tick(); if (pending) await pending;
        term = mul(term, half) / i;
      }
      result = term;
      const factor = -mul(half, half);
      for (let k = 1n; term !== 0n; k++) {
        const pending = tick(); if (pending) await pending;
        term = mul(term, factor) / (k * (order + k));
        result += term;
      }
      if (n < 0n && order % 2n === 1n) result = -result;
    }
  }
  return { coeff: result / (10n ** BigInt(precision - scale)), scale };
}

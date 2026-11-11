const bits = new DataView(new ArrayBuffer(8));

// Preserve the product's low bits until the sum is rounded, like x86 FMA3.
export function resampleMultiplyAdd(a: number, b: number, c: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a * b + c;
  if (!Number.isFinite(c)) return c;
  if (a === 0 || b === 0) return a * b + c;
  if (c === 0) return a * b;
  // Keep all split products and residuals normal on the fast path.
  if ([a, b, c].some(value => Math.abs(value) < 2 ** -450 || Math.abs(value) > 2 ** 450)) {
    return exactMultiplyAdd(a, b, c);
  }
  const product = a * b;
  const splitA = 134217729 * a;
  const splitB = 134217729 * b;
  const highA = splitA - (splitA - a);
  const highB = splitB - (splitB - b);
  const lowA = a - highA;
  const lowB = b - highB;
  const productError = ((highA * highB - product) + highA * lowB + lowA * highB) + lowA * lowB;
  const sum = product + c;
  const part = sum - product;
  const sumError = (product - (sum - part)) + (c - part);
  const correction = productError + sumError;
  // The correction itself can round onto a midpoint. Resolve that rare case
  // from the exact bits instead of rounding twice.
  bits.setFloat64(0, sum);
  const exponent = (bits.getUint32(0) >>> 20) & 2047;
  let halfway = 2 ** (exponent - 1076);
  if (Math.abs(sum) === 2 ** (exponent - 1023) && sum * correction < 0) halfway /= 2;
  return Math.abs(correction) === halfway
    ? exactMultiplyAdd(a, b, c) : sum + correction;
}

function components(value: number): { mantissa: bigint; exponent: number } {
  bits.setFloat64(0, value);
  const raw = bits.getBigUint64(0);
  const exponent = Number(raw >> 52n & 2047n);
  const mantissa = (raw & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
  return { mantissa: raw >> 63n ? -mantissa : mantissa, exponent: exponent ? exponent - 1075 : -1074 };
}

function exactMultiplyAdd(a: number, b: number, c: number): number {
  const x = components(a), y = components(b), z = components(c);
  const productExponent = x.exponent + y.exponent;
  const exponent = Math.min(productExponent, z.exponent);
  // Binary64 bounds these integers to fewer than 4300 bits.
  const exact = (x.mantissa * y.mantissa << BigInt(productExponent - exponent))
    + (z.mantissa << BigInt(z.exponent - exponent));
  if (exact === 0n) return 0;
  const magnitude = exact < 0n ? -exact : exact;
  const shift = Math.max(0, magnitude.toString(2).length - 53, -1074 - exponent);
  let significant = magnitude >> BigInt(shift);
  if (shift) {
    const dropped = magnitude - (significant << BigInt(shift));
    const halfway = 1n << BigInt(shift - 1);
    if (dropped > halfway || dropped === halfway && significant % 2n === 1n) significant++;
  }
  return (exact < 0n ? -1 : 1) * Number(significant) * 2 ** (exponent + shift);
}

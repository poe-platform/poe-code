const timeUnitNanoseconds = {
  day: 86400000000000n,
  hour: 3600000000000n,
  minute: 60000000000n,
  second: 1000000000n,
  millisecond: 1000000n,
  microsecond: 1000n,
  nanosecond: 1n
} as const;

// Inputs are bounded Temporal spans, not arbitrary BigInts. A calendar unit
// supplies its positive interval length; fixed units use the standard divisors.
// Nonzero quotients in this domain are always normal binary64 values.
export function totalTimeDuration(nanoseconds: bigint, unit: keyof typeof timeUnitNanoseconds | bigint): number {
  if (nanoseconds === 0n) return 0;
  const negative = nanoseconds < 0n;
  const numerator = negative ? -nanoseconds : nanoseconds;
  const denominator = typeof unit === "bigint" ? unit : timeUnitNanoseconds[unit];
  let exponent = numerator.toString(2).length - denominator.toString(2).length;
  if (exponent >= 0 ? numerator < denominator << BigInt(exponent)
    : numerator << BigInt(-exponent) < denominator) exponent--;
  const shift = 52 - exponent;
  const scaledNumerator = shift >= 0 ? numerator << BigInt(shift) : numerator;
  const scaledDenominator = shift >= 0 ? denominator : denominator << BigInt(-shift);
  let significand = scaledNumerator / scaledDenominator;
  const twiceRemainder = (scaledNumerator % scaledDenominator) * 2n;
  if (twiceRemainder > scaledDenominator || twiceRemainder === scaledDenominator && significand % 2n !== 0n)
    significand++;
  const result = Number(significand) * 2 ** (exponent - 52);
  return negative ? -result : result;
}

import assert from 'node:assert/strict';

export const maximumMilliseconds = 9007199254740991n;
export const unitMilliseconds = Object.freeze({ '': 1000n, s: 1000n, m: 60000n, h: 3600000n, d: 86400000n });

export function exactRationalDuration(input) {
  assert.equal(typeof input, 'string');
  const match = /^(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))([smhd]?)$/u.exec(input);
  if (!match || match[0].length !== input.length) return { kind: 'invalid-duration' };
  const whole = match[1] ?? '0', fraction = match[2] ?? match[3] ?? '';
  const numerator = BigInt(whole + fraction) * unitMilliseconds[match[4]];
  const denominator = 10n ** BigInt(fraction.length);
  const milliseconds = (numerator + denominator - 1n) / denominator;
  return milliseconds > maximumMilliseconds ? { kind: 'duration-overflow' } : { kind: 'milliseconds', value: milliseconds.toString() };
}

export function materialize(recipe) {
  if (typeof recipe === 'string') return recipe;
  assert.ok(recipe && typeof recipe === 'object');
  assert.ok(Number.isSafeInteger(recipe.count) && recipe.count >= 0 && recipe.count <= 65536);
  assert.equal(typeof recipe.prefix, 'string'); assert.equal(typeof recipe.repeat, 'string'); assert.equal(typeof recipe.suffix, 'string');
  return recipe.prefix + recipe.repeat.repeat(recipe.count) + recipe.suffix;
}

export type Random = () => number;

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export function randomInt(random: Random, maximum: number): number {
  return Math.floor(random() * maximum);
}

export function pick<T>(random: Random, values: readonly T[]): T {
  return values[randomInt(random, values.length)] as T;
}

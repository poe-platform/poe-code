export function randomInteger(maximum: number): number {
  const range = 0x1_0000_0000;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > range) {
    throw new RangeError("Random integer maximum must be an integer from 1 to 2^32");
  }
  const limit = Math.floor(range / maximum) * maximum;
  const sample = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(sample); } while (sample[0]! >= limit);
  return sample[0]! % maximum;
}

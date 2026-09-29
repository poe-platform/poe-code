const randomPool = new Uint32Array(256);
let randomPoolOffset = randomPool.length;

function nextRandomUint32(): number {
  if (randomPoolOffset >= randomPool.length) {
    globalThis.crypto.getRandomValues(randomPool);
    randomPoolOffset = 0;
  }
  return randomPool[randomPoolOffset++]!;
}

export function randomInteger(maximum: number): number {
  const range = 0x1_0000_0000;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > range) {
    throw new RangeError("Random integer maximum must be an integer from 1 to 2^32");
  }
  const limit = Math.floor(range / maximum) * maximum;
  let sample = nextRandomUint32();
  while (sample >= limit) {
    sample = nextRandomUint32();
  }
  return sample % maximum;
}

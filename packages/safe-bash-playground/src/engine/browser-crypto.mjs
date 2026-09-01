export { createHash, randomBytes, randomUUID } from "@jspm/core/nodelibs/crypto";

export function randomInt(minimum, maximum) {
  if (maximum === undefined) {
    maximum = minimum;
    minimum = 0;
  }
  const range = maximum - minimum;
  if (
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    range < 1 ||
    range > 2 ** 32
  )
    throw new RangeError("Unsupported random integer range");
  const ceiling = Math.floor(2 ** 32 / range) * range;
  const bytes = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(bytes);
  } while (bytes[0] >= ceiling);
  return minimum + (bytes[0] % range);
}

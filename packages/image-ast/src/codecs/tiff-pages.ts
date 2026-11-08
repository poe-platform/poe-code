/** Walk classic TIFF and BigTIFF directories without retaining a page table. */
export function* tiffPageSteps(size: number, page = 0): Generator<number, { offset: number; pages: number }, number | undefined> {
  if (!Number.isSafeInteger(page) || page < 0) throw new RangeError("Invalid TIFF page");
  const littleEndian = (yield 0) === 73;
  function* number(at: number, length: number): Generator<number, number, number | undefined> {
    if (!Number.isSafeInteger(at) || at < 0 || at + length > size) throw new RangeError("Truncated TIFF directory");
    let value = 0;
    for (let i = 0; i < length; i++) {
      const byte = yield at + i;
      if (byte === undefined) throw new RangeError("Truncated TIFF directory");
      value += byte * 2 ** (8 * (littleEndian ? i : length - i - 1));
    }
    if (!Number.isSafeInteger(value)) throw new RangeError("Unsafe TIFF integer");
    return value;
  }
  const big = (yield* number(2, 2)) === 43;
  if (big && ((yield* number(4, 2)) !== 8 || (yield* number(6, 2)) !== 0)) throw new RangeError("Invalid BigTIFF header");
  const countSize = big ? 8 : 2, entrySize = big ? 20 : 12, offsetSize = big ? 8 : 4;
  let current = yield* number(big ? 8 : 4, offsetSize), offset = 0, pages = 0;
  let checkpoint = current, power = 1, distance = 0;
  while (current !== 0) {
    if (pages === page) offset = current;
    pages++;
    const count = yield* number(current, countSize);
    current = yield* number(current + countSize + count * entrySize, offsetSize);
    // Brent's cycle detection bounds memory even for long directory chains.
    if (current !== 0 && current === checkpoint) throw new RangeError("Cyclic TIFF directory chain");
    if (++distance === power) { checkpoint = current; power *= 2; distance = 0; }
  }
  if (offset === 0) throw new RangeError("TIFF page out of range");
  return { offset, pages };
}

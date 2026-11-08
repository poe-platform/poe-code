/** Walk classic TIFF directories without retaining a page table. */
export function* tiffPageSteps(size: number, page = 0): Generator<number, { offset: number; pages: number }, number | undefined> {
  if (!Number.isSafeInteger(page) || page < 0) throw new RangeError("Invalid TIFF page");
  const littleEndian = (yield 0) === 73;
  function* number(at: number, length: number): Generator<number, number, number | undefined> {
    if (at < 0 || at + length > size) throw new RangeError("Truncated TIFF directory");
    let value = 0;
    for (let i = 0; i < length; i++) {
      const byte = yield at + i;
      if (byte === undefined) throw new RangeError("Truncated TIFF directory");
      value += byte * 2 ** (8 * (littleEndian ? i : length - i - 1));
    }
    return value;
  }
  let current = yield* number(4, 4), offset = 0, pages = 0;
  let checkpoint = current, power = 1, distance = 0;
  while (current !== 0) {
    if (pages === page) offset = current;
    pages++;
    const count = yield* number(current, 2);
    current = yield* number(current + 2 + count * 12, 4);
    // Brent's cycle detection bounds memory even for long directory chains.
    if (current !== 0 && current === checkpoint) throw new RangeError("Cyclic TIFF directory chain");
    if (++distance === power) { checkpoint = current; power *= 2; distance = 0; }
  }
  if (offset === 0) throw new RangeError("TIFF page out of range");
  return { offset, pages };
}

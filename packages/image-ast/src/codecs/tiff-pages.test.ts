import { expect, it } from "vitest";
import { tiffPageSteps } from "./tiff-pages.js";

function directories(littleEndian: boolean) {
  const bytes = new Uint8Array(26), view = new DataView(bytes.buffer);
  bytes.set(littleEndian ? [73, 73] : [77, 77]);
  view.setUint32(4, 20, littleEndian);
  view.setUint32(22, 8, littleEndian);
  view.setUint32(10, 14, littleEndian);
  return { bytes, view };
}
function read(bytes: Uint8Array, page: number) {
  const steps = tiffPageSteps(bytes.length, page);
  let next = steps.next(), reads = 0;
  while (!next.done) {
    expect(++reads).toBeLessThan(200);
    next = steps.next(bytes[next.value]);
  }
  return next.value;
}
for (const littleEndian of [true, false]) {
  it(`walks nonsequential TIFF directories, littleEndian=${littleEndian}`, () => {
    const { bytes } = directories(littleEndian);
    expect([0, 1, 2].map(page => read(bytes, page))).toEqual([20, 8, 14].map(offset => ({offset, pages: 3})));
    expect(() => read(bytes, 3)).toThrow("out of range");
  });
  it(`rejects cyclic and truncated TIFF directories, littleEndian=${littleEndian}`, () => {
    const { bytes, view } = directories(littleEndian);
    view.setUint32(16, 8, littleEndian);
    expect(() => read(bytes, 0)).toThrow("Cyclic");
    view.setUint32(16, 25, littleEndian);
    expect(() => read(bytes, 0)).toThrow("Truncated");
  });
}

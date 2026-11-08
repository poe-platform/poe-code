import { expect, it } from "vitest";
import { tiffPageSteps } from "./tiff-pages.js";

for (const le of [true, false]) {
  it(`walks BigTIFF page links and rejects cycles (little endian: ${le})`, () => {
    const bytes = new Uint8Array(48), view = new DataView(bytes.buffer);
    bytes.set(le ? [73, 73] : [77, 77]);
    view.setUint16(2, 43, le);
    view.setUint16(4, 8, le);
    view.setBigUint64(8, 16n, le);
    view.setBigUint64(24, 32n, le);
    const read = (page: number) => {
      const steps = tiffPageSteps(bytes.length, page);
      let next = steps.next();
      while (!next.done) next = steps.next(bytes[next.value]);
      return next.value;
    };
    expect(read(0)).toEqual({ offset: 16, pages: 2 });
    expect(read(1)).toEqual({ offset: 32, pages: 2 });
    expect(() => read(2)).toThrow("out of range");
    view.setBigUint64(40, 16n, le);
    expect(() => read(0)).toThrow("Cyclic");
  });
}

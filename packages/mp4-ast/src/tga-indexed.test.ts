import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeTga } from "./containers/tga.js";

function indexed(rle: boolean, descriptor = 32, depth = 8, paletteDepth = 24) {
  const first = depth === 16 ? 300 : 7;
  const header = new Uint8Array(18), view = new DataView(header.buffer);
  header[0] = 2; header[1] = 1; header[2] = rle ? 9 : 1;
  view.setUint16(3, first, true); view.setUint16(5, 2, true);
  header[7] = paletteDepth; header[12] = 2; header[14] = 2;
  header[16] = depth; header[17] = descriptor;
  const palette = paletteDepth === 32 ? [30, 20, 10, 127, 60, 50, 40, 0] : [30, 20, 10, 60, 50, 40];
  const index = (value: number) => depth === 16 ? [value & 255, value >> 8] : [value];
  // A repeated packet crosses the row boundary, followed by a raw packet.
  const payload = rle ? [0x82, ...index(first), 0, ...index(first + 1)]
    : [first, first, first, first + 1].flatMap(index);
  return Uint8Array.from([...header, 65, 66, ...palette, ...payload]);
}

for (const rle of [false, true]) for (const depth of [8, 16]) for (const paletteDepth of [24, 32]) {
  for (const origin of [0, 16, 32, 48]) {
    it(`decodes indexed TGA with ID, palette offset, origin=${origin}, RLE=${rle}, index=${depth}, palette=${paletteDepth}`, () => {
      const a = [10, 20, 30, paletteDepth === 32 ? 127 : 255], b = [40, 50, 60, paletteDepth === 32 ? 0 : 255];
      const rows = [[a, a], [a, b]];
      if (!(origin & 32)) rows.reverse();
      if (origin & 16) rows.forEach(row => row.reverse());
      const decoded = decodeTga(indexed(rle, origin, depth, paletteDepth));
      assert.equal(decoded.width, 2); assert.equal(decoded.height, 2);
      assert.deepEqual([...decoded.data], rows.flat(2));
    });
  }
}
for (const [name, mutate, message] of [
  ["palette", (b: Uint8Array) => b.slice(0, 25), "Truncated TGA color map"],
  ["index", (b: Uint8Array) => b.slice(0, -1), "Truncated TGA pixels"],
  ["low index", (b: Uint8Array) => { b[26] = 6; return b; }, "TGA color map index out of range"],
  ["high index", (b: Uint8Array) => { b[26] = 9; return b; }, "TGA color map index out of range"],
  ["empty palette", (b: Uint8Array) => { b[5] = 0; return b; }, "Unsupported TGA image format"],
  ["overflowing palette", (b: Uint8Array) => { b[3] = 255; b[4] = 255; return b; }, "Unsupported TGA image format"]
] as const) {
  it(`rejects invalid indexed ${name}`, () => {
    assert.throws(() => decodeTga(mutate(indexed(false))), { message });
  });
}
for (const [payload, message] of [
  [[], "Truncated TGA RLE packet"], [[0x83], "Truncated TGA pixels"],
  [[0x84, 7], "TGA RLE packet exceeds image dimensions"]
] as const) {
  it(`rejects malformed indexed RLE: ${message}`, () => {
    assert.throws(() => decodeTga(Uint8Array.from([...indexed(true).slice(0, 26), ...payload])), { message });
  });
}
it("checks indexed pixel and memory budgets before decoding", () => {
  for (const limits of [{ maxMemoryBytes: 15 }, { maxPixelsPerFrame: 3 }]) {
    assert.throws(() => decodeTga(indexed(false), { limits }));
  }
});

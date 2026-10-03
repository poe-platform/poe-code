import { expect, it } from "vitest";
import { FontWidths } from "./widths.js";
import { PdfFontAllocation } from "./memory.js";

it("offers Type1 decoding a mutable width view without expanding CID ranges", () => {
  let admitted = 0;
  const widths = new FontWidths(new PdfFontAllocation({ onAllocation(bytes) { admitted += bytes; } }));
  widths.set(0, 500, 65535);
  const view = widths.createType1View();
  expect(view[65535]).toBe(500); expect(view[65536]).toBeUndefined();
  view[65536] = 700;
  expect(view[65536]).toBe(700); expect(widths.get(65536)).toBeUndefined();
  expect(admitted).toBeLessThan(512);
});

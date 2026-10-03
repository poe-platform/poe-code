import { createCffGlyphRenderer } from "./cff.js";
import { expect, it } from "vitest";
import { Type2Compiled, type CffFont } from "../vendor/pdfjs-fonts.mjs";

it("admits CFF outline work before parsing a charstring", () => {
  const code = new Uint8Array([139, 139, 21, 239, 139, 5, 14]);
  const renderer = new Type2Compiled({ glyphs: [code] }, [], [0.001, 0, 0, 0.001, 0, 0]);
  const failure = new Error("font outline budget exhausted");
  expect(() => renderer.compileGlyph(code, 0, () => { throw failure; })).toThrow(failure);
});

it("charges subroutine expansion even when its encoded input is compact", () => {
  // The local subroutine is invoked twice and emits a line each time.
  const code = new Uint8Array([139, 139, 21, 32, 10, 32, 10, 14]);
  const subr = new Uint8Array([149, 139, 5, 11]);
  const renderer = new Type2Compiled({ glyphs: [code], subrs: [subr] }, [], [0.001, 0, 0, 0.001, 0, 0]);
  const expected = renderer.compileGlyph(code, 0);
  let admitted = 0;
  const actual = renderer.compileGlyph(code, 0, bytes => { admitted += bytes; });
  expect(Array.from(actual)).toEqual(Array.from(expected));
  expect(admitted).toBeGreaterThan(code.length + subr.length);
});


it("propagates outline admission from the shared CFF renderer", () => {
  const cff = {
    isCIDFont: false, charset: { charset: ["A"] },
    charStrings: { objects: [new Uint8Array([139, 139, 21, 239, 139, 5, 14])] },
    globalSubrIndex: { objects: [] }, topDict: { getByName: () => undefined },
  } as unknown as CffFont;
  const failure = new Error("outline owner rejected allocation"); let rendering = false;
  const render = createCffGlyphRenderer(cff, { onAllocation() { if (rendering) throw failure; } });
  rendering = true;
  expect(() => render(0)).toThrow(failure);
});


it("evicts old CFF outlines when cached paths exceed the working cache", () => {
  const code = new Uint8Array([139, 139, 21, 239, 139, 5, 14]);
  const cff = {
    isCIDFont: false, charset: { charset: Array(800).fill("A") },
    charStrings: { objects: Array(800).fill(code) },
    globalSubrIndex: { objects: [] }, topDict: { getByName: () => undefined },
  } as unknown as CffFont;
  const render = createCffGlyphRenderer(cff);
  const first = render(0);
  expect(render(0)).toBe(first);
  for (let glyph = 1; glyph < 800; glyph++) render(glyph);
  const last = render(799);
  expect(render(799)).toBe(last);
  expect(render(0)).not.toBe(first);
  expect(render(0)).toEqual(first);
});

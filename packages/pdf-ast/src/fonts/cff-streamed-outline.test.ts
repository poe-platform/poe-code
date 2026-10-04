import { expect, it } from "vitest";
import { Type2Compiled, DrawOPS } from "../vendor/pdfjs-fonts.mjs";

it.each([1024, 4096])("streams %i expanded lines with fixed outline scratch", (count) => {
  const code = new Uint8Array(4 + count * 2);
  code.set([139, 139, 21]);
  for (let i = 0; i < count; i++) code.set([32, 10], 3 + i * 2);
  code[code.length - 1] = 14;
  const subr = Uint8Array.of(140, 139, 5, 11);
  const renderer = new Type2Compiled({ glyphs: [code], subrs: [subr] }, [], [1, 0, 0, 1, 0, 0]);
  const expected = renderer.compileGlyph(code, 0);
  let admitted = 0,
    lines = 0,
    closes = 0;
  for (const chunk of renderer.glyphCommands(code, 0, (bytes) => {
    admitted += bytes;
    if (admitted > 16384) throw new Error("Unbounded glyph scratch");
  })) {
    expect(chunk.length).toBeLessThanOrEqual(256);
    if (chunk[0] === DrawOPS.moveTo) expect(Array.from(chunk)).toEqual([DrawOPS.moveTo, 0, 0]);
    else if (chunk[0] === DrawOPS.lineTo) {
      lines++;
      expect(Array.from(chunk)).toEqual([DrawOPS.lineTo, expected[3 + (lines - 1) * 3 + 1], 0]);
    } else {
      expect(Array.from(chunk)).toEqual([DrawOPS.closePath]);
      closes++;
    }
  }
  expect(lines).toBe(count);
  expect(closes).toBe(1);
});

it("preserves curve precision and global subroutine output", () => {
  const code = Uint8Array.of(140, 141, 21, 32, 29, 14);
  const subr = Uint8Array.of(140, 141, 142, 143, 144, 145, 8, 11);
  const renderer = new Type2Compiled(
    { glyphs: [code], gsubrs: [subr] },
    [],
    [0.003, 0, 0, 0.007, 2, 3]
  );
  const expected = Array.from(renderer.compileGlyph(code, 0));
  const actual = [...renderer.glyphCommands(code, 0)].flatMap((chunk) => Array.from(chunk));
  expect(actual).toEqual(expected);
});

it("stops an outline on early consumer return and preserves subsequent rendering", () => {
  const code = Uint8Array.of(139, 139, 21, 140, 139, 5, 14);
  const renderer = new Type2Compiled({ glyphs: [code] }, [], [1, 0, 0, 1, 0, 0]);
  const stream = renderer.glyphCommands(code, 0);
  expect(Array.from(stream.next().value!)).toEqual([DrawOPS.moveTo, 0, 0]);
  stream.return(undefined);
  expect(stream.next().done).toBe(true);
  expect([...renderer.glyphCommands(code, 0)].flatMap((chunk) => Array.from(chunk))).toEqual(
    Array.from(renderer.compileGlyph(code, 0))
  );
});

it("propagates scratch admission before interpreting the glyph", () => {
  const code = Uint8Array.of(139, 139, 21, 14),
    failure = new Error("owner rejected scratch");
  const renderer = new Type2Compiled({ glyphs: [code] }, [], [1, 0, 0, 1, 0, 0]);
  expect(() =>
    renderer
      .glyphCommands(code, 0, () => {
        throw failure;
      })
      .next()
  ).toThrow(failure);
});

it("preserves long operand runs accepted by the existing compiler without collecting their drawing output", () => {
  const code = new Uint8Array(405);
  code.set([139, 139, 21]); code.fill(140, 3, 403); code.set([5, 14], 403);
  const renderer = new Type2Compiled({ glyphs: [code] }, [], [1, 0, 0, 1, 0, 0]);
  const expected = Array.from(renderer.compileGlyph(code, 0));
  const actual: number[] = []; let admission = 0;
  for (const chunk of renderer.glyphCommands(code, 0, bytes => { admission += bytes; })) {
    expect(chunk.length).toBeLessThanOrEqual(7);
    actual.push(...Array.from(chunk));
  }
  expect(actual).toEqual(expected);
  expect(admission).toBeGreaterThan(16384);
});

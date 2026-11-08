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
  code.set([139, 139, 21]);
  code.fill(140, 3, 403);
  code.set([5, 14], 403);
  const renderer = new Type2Compiled({ glyphs: [code] }, [], [1, 0, 0, 1, 0, 0]);
  const expected = Array.from(renderer.compileGlyph(code, 0));
  const actual: number[] = [];
  let admission = 0;
  for (const chunk of renderer.glyphCommands(code, 0, (bytes) => {
    admission += bytes;
  })) {
    expect(chunk.length).toBeLessThanOrEqual(7);
    actual.push(...Array.from(chunk));
  }
  expect(actual).toEqual(expected);
  expect(admission).toBeGreaterThan(16384);
});

it("backs growing operand runs with constant renderer scratch", async () => {
  const { createCffGlyphRenderer } = await import("./cff.js");
  for (const count of [1024, 4096]) {
    const code = new Uint8Array(count + 5);
    code.set([139, 139, 21]);
    code.fill(140, 3, count + 3);
    code.set([5, 14], count + 3);
    const cff = {
      isCIDFont: false,
      charset: { charset: ["A"] },
      charStrings: { objects: [code] },
      globalSubrIndex: { objects: [] },
      topDict: { getByName: () => [1, 0, 0, 1, 0, 0] }
    } as unknown as import("../vendor/pdfjs-fonts.mjs").CffFont;
    let admitted = 0,
      end = 0;
    const data = new Uint8Array(65536);
    const render = createCffGlyphRenderer(cff, {
      onAllocation(bytes) {
        admitted += bytes;
        if (admitted > 40000) throw Error("growing operand scratch");
      }
    });
    const storage = {
      allocate(n: number) {
        const at = end;
        end += n;
        return at;
      },
      async read(at: number, n: number) {
        return data.slice(at, at + n);
      },
      async write(at: number, bytes: Uint8Array) {
        data.set(bytes, at);
      }
    };
    let segments = 0;
    for await (const segment of render.storedSegments(0, storage)) {
      segments++;
      if (segment.kind === "line") expect(segment.x).toBe(segments - 1);
    }
    expect(segments).toBe(count / 2 + 2);
    expect(admitted).toBeLessThanOrEqual(40000);
  }
});

it("observes timer cancellation while processing a long backed operand run", async () => {
  const { createCffGlyphRenderer } = await import("./cff.js");
  const code = new Uint8Array(8197);
  code.set([139, 139, 21]);
  code.fill(140, 3, 8195);
  code.set([5, 14], 8195);
  const cff = {
    isCIDFont: false,
    charset: { charset: ["A"] },
    charStrings: { objects: [code] },
    globalSubrIndex: { objects: [] },
    topDict: { getByName: () => [1, 0, 0, 1, 0, 0] }
  } as unknown as import("../vendor/pdfjs-fonts.mjs").CffFont;
  const data = new Uint8Array(128 * 1024);
  let end = 0;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      return data.slice(at, at + n);
    },
    async write(at: number, bytes: Uint8Array) {
      data.set(bytes, at);
    }
  };
  const controller = new AbortController(),
    reason = new Error("cancel glyph");
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await expect(
      (async () => {
        for await (const ignored of createCffGlyphRenderer(cff).storedSegments(
          0,
          storage,
          controller.signal
        )) {
          /* consume */
        }
      })()
    ).rejects.toBe(reason);
  } finally {
    clearTimeout(timer);
  }
});

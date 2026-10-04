import { expect, it } from "vitest";
import { parseTrueTypeFont } from "./truetype.js";
import { parseStoredTrueTypeFont } from "./stored-truetype.js";
import type { PdfPixelStorage, PdfPathSegment } from "../ast.js";
function triangleFont(
  notdef = false,
  withCmap = true,
  options: Parameters<typeof parseTrueTypeFont>[1] = {}
) {
  const buf = new ArrayBuffer(512);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint32(0, 0x00010000);
  dv.setUint16(4, withCmap ? 7 : 6);
  const writeTag = (off: number, tag: string, tOff: number, tLen: number) => {
    for (let i = 0; i < 4; i++) u8[off + i] = tag.charCodeAt(i);
    dv.setUint32(off + 8, tOff);
    dv.setUint32(off + 12, tLen);
  };
  writeTag(12, "head", 140, 54);
  writeTag(28, "maxp", 196, 6);
  writeTag(44, "hhea", 204, 36);
  writeTag(60, "hmtx", 240, 8);
  writeTag(76, "loca", 248, 6);
  writeTag(92, "glyf", 256, 32);
  writeTag(108, "cmap", 300, 44);
  dv.setUint16(140 + 18, 1000);
  dv.setInt16(140 + 50, 0);
  dv.setUint16(196 + 4, 2);
  dv.setInt16(204 + 4, 800);
  dv.setInt16(204 + 6, -200);
  dv.setUint16(204 + 34, 2);
  dv.setUint16(240, 500);
  dv.setUint16(244, 700);
  dv.setUint16(248, 0);
  dv.setUint16(250, 0);
  dv.setUint16(252, 12);
  dv.setInt16(256, 1);
  dv.setInt16(258, 100);
  dv.setInt16(260, 0);
  dv.setInt16(262, 600);
  dv.setInt16(264, 700);
  dv.setUint16(266, 2);
  dv.setUint16(268, 0);
  u8[270] = 0x01 | 0x02 | 0x20;
  u8[271] = 0x01 | 0x02 | 0x04 | 0x10;
  u8[272] = 0x01 | 0x02 | 0x04;
  u8[273] = 100;
  u8[274] = 250;
  u8[275] = 250;
  u8[276] = 250;
  u8[277] = 250;
  dv.setUint16(300, 0);
  dv.setUint16(302, 1);
  dv.setUint16(304, 3);
  dv.setUint16(306, 1);
  dv.setUint32(308, 12);
  const f4 = 312;
  dv.setUint16(f4, 4);
  dv.setUint16(f4 + 2, 32);
  dv.setUint16(f4 + 6, 4);
  dv.setUint16(f4 + 14, 0x0041);
  dv.setUint16(f4 + 16, 0xffff);
  dv.setUint16(f4 + 18, 0);
  dv.setUint16(f4 + 20, 0x0041);
  dv.setUint16(f4 + 22, 0xffff);
  dv.setInt16(f4 + 24, -64);
  dv.setInt16(f4 + 26, 1);
  dv.setUint16(f4 + 28, 0);
  dv.setUint16(f4 + 30, 0);

  if (notdef) dv.setUint16(250, 12); // Put the triangle in glyph zero, leaving glyph one empty.
  return parseTrueTypeFont(u8, options);
}

function backing(input: Uint8Array) {
  const chunks = new Map<number, number>();
  let end = input.length,
    maxRead = 0,
    maxWrite = 0;
  const storage: PdfPixelStorage = {
    allocate(length) {
      const at = end;
      end += length;
      return at;
    },
    async read(at, length) {
      maxRead = Math.max(maxRead, length);
      return Uint8Array.from({ length }, (_, i) =>
        at + i < input.length ? input[at + i]! : (chunks.get(at + i) ?? 0)
      );
    },
    async write(at, bytes) {
      maxWrite = Math.max(maxWrite, bytes.length);
      for (let i = 0; i < bytes.length; i++) chunks.set(at + i, bytes[i]!);
    }
  };
  return { storage, stats: () => ({ maxRead, maxWrite, end }) };
}
it("reads TrueType tables and glyphs through bounded caller ranges", async () => {
  const native = triangleFont(),
    input = new Uint8Array(1024 * 1024);
  input.set(native.bytes);
  const store = backing(input),
    admissions: number[] = [];
  const font = await parseStoredTrueTypeFont(
    { storage: store.storage, position: 0, byteLength: input.length },
    { onAllocation: (n) => admissions.push(n) }
  );
  expect(font).toBeDefined();
  expect(await font!.getGlyphId(65)).toBe(1);
  expect(await font!.getAdvanceWidthUnits(1)).toBe(native.getAdvanceWidthUnits(1));
  const segments: PdfPathSegment[] = [];
  for await (const segment of font!.glyphSegments(1)) segments.push(segment);
  expect(segments).toEqual(native.getGlyphOutlineByGid(1));
  expect(store.stats().maxRead).toBeLessThanOrEqual(4096);
  expect(store.stats().maxWrite).toBeLessThanOrEqual(4096);
  expect(admissions.reduce((a, b) => a + b, 0)).toBeLessThan(65536);
});
it("preserves backing errors and cancellation", async () => {
  const input = triangleFont().bytes,
    store = backing(input),
    failure = new Error("remote failed");
  store.storage.read = async () => {
    throw failure;
  };
  await expect(
    parseStoredTrueTypeFont({ storage: store.storage, position: 0, byteLength: input.length })
  ).rejects.toBe(failure);
  const controller = new AbortController();
  controller.abort(failure);
  await expect(
    parseStoredTrueTypeFont(
      { storage: store.storage, position: 0, byteLength: input.length },
      { signal: controller.signal }
    )
  ).rejects.toBe(failure);
});

it.each([false, true])(
  "preserves compound and quadratic contour arithmetic (compound=%s)",
  async (compound) => {
    const bytes = triangleFont().bytes,
      view = new DataView(bytes.buffer);
    bytes[270] = 0x22;
    bytes[271] = 0x36;
    bytes[272] = 0x06;
    if (compound) {
      view.setUint16(250, 20);
      view.setUint16(252, 32);
      view.setInt16(296, -1);
      view.setUint16(306, 0x0083);
      view.setUint16(308, 0);
      view.setInt16(310, 19);
      view.setInt16(312, -7);
      view.setInt16(314, 12000);
      view.setInt16(316, -700);
      view.setInt16(318, 500);
      view.setInt16(320, 15000);
      // The cmap is optional here and overlaps the synthetic composite bytes.
      view.setUint16(4, 6);
    }
    const native = parseTrueTypeFont(bytes),
      store = backing(bytes),
      font = await parseStoredTrueTypeFont({
        storage: store.storage,
        position: 0,
        byteLength: bytes.length
      });
    for (const gid of [0, 1, 2, -1]) {
      const result = [];
      for await (const segment of font!.glyphSegments(gid)) result.push(segment);
      expect(result).toEqual(native.getGlyphOutlineByGid(gid));
    }
  }
);

it("streams a maximum-size simple glyph with fixed working admission", async () => {
  const bytes = new Uint8Array(70000);
  bytes.set(triangleFont().bytes);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 6);
  view.setUint16(266, 65535);
  view.setUint16(252, 32000);
  // 256 repeated flags per record, with constant coordinates and no instructions.
  let at = 270;
  for (let i = 0; i < 256; i++) {
    bytes[at++] = 0x39;
    bytes[at++] = 255;
  }
  const store = backing(bytes),
    font = await parseStoredTrueTypeFont(
      { storage: store.storage, position: 0, byteLength: bytes.length },
      { maxWorkingBytes: 32768 }
    );
  let count = 0;
  for await (const segment of font!.glyphSegments(1)) {
    expect(segment.kind).toBe(count === 0 ? "move" : count === 65536 ? "close" : "line");
    count++;
  }
  expect(count).toBe(65537);
  expect(store.stats().maxRead).toBeLessThanOrEqual(4096);
  expect(store.stats().maxWrite).toBeLessThanOrEqual(4096);
});

it.each([
  ...Array.from({ length: 8 }, (_, mode) => ({ mode, mapping: "unicode" })),
  { mode: 0, mapping: "symbol" },
  { mode: 0, mapping: "post" }
])(
  "renders retained TrueType text and clip pixels exactly in mode $mode with $mapping mapping",
  async ({ mode, mapping }) => {
    const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
    const { PagedStorage } = await import("@poe-code/safe-fs/storage");
    const { PdfDocument } = await import("../document.js");
    const { PdfRetainedDocument } = await import("../retained-document.js");
    const { PdfFileSource } = await import("../source.js");
    const { cosDict, cosName, cosNumber, cosArray, dictSet, cosStream } = await import("../ast.js");
    const { renderDisplayListToBitmap, renderOperationStreamWindow } =
      await import("../render/raster.js");
    const document = PdfDocument.create(),
      page = document.addPage([32, 32]),
      bytes = new Uint8Array(524288);
    bytes.set(triangleFont().bytes);
    const view = new DataView(bytes.buffer);
    if (mapping === "symbol") {
      view.setUint16(306, 0);
      view.setUint16(326, 0xf041);
      view.setUint16(332, 0xf041);
      view.setInt16(336, 1 - 0xf041);
    } else if (mapping === "post") {
      for (let i = 0; i < 4; i++) bytes[108 + i] = "post".charCodeAt(i);
      view.setUint32(116, 600);
      view.setUint32(120, 38);
      view.setUint32(600, 0x20000);
      view.setUint16(632, 2);
      view.setUint16(634, 0);
      view.setUint16(636, 36);
    }
    const descriptor = cosDict({ FontFile2: document.cos.allocateObject(cosStream(bytes)) });
    const font = cosDict({
      Subtype: cosName("TrueType"),
      BaseFont: cosName("Test"),
      FontDescriptor: descriptor,
      Encoding: cosName("WinAnsiEncoding"),
      ...(mapping !== "unicode"
        ? {
            ToUnicode: document.cos.allocateObject(
              cosStream(new TextEncoder().encode("1 beginbfchar <41> <005a> endbfchar"))
            )
          }
        : {})
    });
    const nums = (values: number[]) => cosArray(values.map((value) => cosNumber(value)));
    const pattern = cosStream(new TextEncoder().encode("1 0 0 rg 0 0 2 2 re f"), {
      dict: cosDict({
        Type: cosName("Pattern"),
        PatternType: cosNumber(1),
        PaintType: cosNumber(1),
        TilingType: cosNumber(1),
        BBox: nums([0, 0, 4, 4]),
        XStep: cosNumber(4),
        YStep: cosNumber(4),
        Resources: cosDict()
      })
    });
    dictSet(
      page.pageDict,
      "Resources",
      cosDict({
        Font: cosDict({ F: document.cos.allocateObject(font) }),
        Pattern: cosDict({ P: document.cos.allocateObject(pattern) })
      })
    );
    page.setRawContentStream(
      `/Pattern cs /P scn BT /F 20 Tf ${mode} Tr 4 8 Td (AA) Tj ET 0 0 1 rg 0 0 32 16 re f`
    );
    const display = page.evaluateDisplayList(),
      expected = renderDisplayListToBitmap(display, { scale: 1, transparent: true });
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    await fs.writeFile("/input", document.save());
    const resources = { fs, directory: "/scratch" },
      source = await PdfFileSource.open(fs, "/input"),
      doc = await PdfRetainedDocument.open(source, resources),
      storage = new PagedStorage(
        { fs, cwd: "/scratch", env: {}, signal: new AbortController().signal },
        2
      );
    try {
      const retainedPage = (await doc.pages().next()).value!;
      const actual = await renderOperationStreamWindow(
        display,
        async function* () {
          for await (const event of retainedPage.evaluateSteps(resources, {
            imageStorage: storage,
            onAllocation(bytes) {
              if (bytes > 65536 * 5) throw Error("whole font allocation " + bytes);
            }
          }))
            if (!event.captured) yield event.operation;
        },
        { x: 0, y: 0, width: 32, height: 32 },
        { scale: 1, transparent: true }
      );
      expect(actual).toEqual(expected);
    } finally {
      await storage.close();
      await doc.close();
      await source.close();
      expect(await fs.readdir("/scratch")).toEqual([]);
    }
  }
);

it("preserves format-4 overlaps, range offsets, symbols, widths and optional post names", async () => {
  const bytes = new Uint8Array(1024);
  bytes.set(triangleFont().bytes);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 8);
  for (let i = 0; i < 4; i++) bytes[124 + i] = "post".charCodeAt(i);
  view.setUint32(132, 600);
  view.setUint32(136, 44);
  view.setUint32(600, 0x20000);
  view.setUint16(632, 2);
  view.setUint16(634, 0);
  view.setUint16(636, 258);
  bytes.set([5, 67, 117, 115, 116, 111], 638);
  for (const symbolic of [false, true]) {
    view.setUint16(306, symbolic ? 0 : 1);
    const native = parseTrueTypeFont(bytes),
      store = backing(bytes),
      font = await parseStoredTrueTypeFont({
        storage: store.storage,
        position: 0,
        byteLength: bytes.length
      });
    expect(font!.isSymbolicCmap).toBe(native.isSymbolicCmap);
    expect(await font!.findGlyphName("Custo")).toBe(native.glyphNames.indexOf("Custo"));
    expect(await font!.findGlyphName(".notdef")).toBe(0);
    expect(await font!.findGlyphName("Missing")).toBe(-1);
    for (const code of [-1, 0, 64, 65, 66, 65535, 0x10000, NaN])
      expect(await font!.getGlyphId(code)).toBe(native.getGlyphId(code));
    for (const gid of [-1, 0, 1, 2, 0.5, NaN])
      expect(await font!.getAdvanceWidthUnits(gid)).toBe(native.getAdvanceWidthUnits(gid));
  }
  // A truncated custom name invalidates all optional names, including standard names.
  view.setUint32(136, 43);
  const store = backing(bytes),
    font = await parseStoredTrueTypeFont({
      storage: store.storage,
      position: 0,
      byteLength: bytes.length
    });
  expect(await font!.findGlyphName(".notdef")).toBe(-1);
});

it("preserves format-12 overlapping last-match and capped-range behavior", async () => {
  const bytes = new Uint8Array(1024);
  bytes.set(triangleFont().bytes);
  const view = new DataView(bytes.buffer);
  view.setUint16(312, 12);
  view.setUint32(324, 3);
  for (const [i, [start, end, gid]] of [
    [65, 68, 1],
    [66, 66, 0],
    [100, 1000000, 3]
  ].entries()) {
    view.setUint32(328 + i * 12, start!);
    view.setUint32(332 + i * 12, end!);
    view.setUint32(336 + i * 12, gid!);
  }
  const native = parseTrueTypeFont(bytes),
    store = backing(bytes),
    font = await parseStoredTrueTypeFont({
      storage: store.storage,
      position: 0,
      byteLength: bytes.length
    });
  for (const code of [64, 65, 66, 67, 68, 69, 100, 65535 + 100, 65536 + 100, 1000000])
    expect(await font!.getGlyphId(code)).toBe(native.getGlyphId(code));
});

it("copies borrowed source and scratch reads before later backend calls", async () => {
  const input = triangleFont().bytes,
    store = backing(input),
    read = store.storage.read,
    borrowed = new Uint8Array(4096);
  store.storage.read = async (at, length) => {
    borrowed.set(await read(at, length));
    return borrowed.subarray(0, length);
  };
  const write = store.storage.write;
  store.storage.write = async (at, bytes) => {
    await write(at, bytes);
    borrowed.fill(255);
  };
  const font = await parseStoredTrueTypeFont({
    storage: store.storage,
    position: 0,
    byteLength: input.length
  });
  const segments = [];
  for await (const segment of font!.glyphSegments(1)) segments.push(segment);
  expect(segments).toEqual(triangleFont().getGlyphOutlineByGid(1));
  const failure = new Error("scratch write failed");
  store.storage.write = async () => {
    throw failure;
  };
  await expect(font!.glyphSegments(1).next()).rejects.toBe(failure);
});

it("reuses released glyph scratch and isolates interleaved iterators", async () => {
  const input = triangleFont().bytes,
    store = backing(input),
    font = await parseStoredTrueTypeFont({
      storage: store.storage,
      position: 0,
      byteLength: input.length
    });
  const first = font!.glyphSegments(1);
  await first.next();
  const second = font!.glyphSegments(1);
  await second.next();
  await first.return(undefined);
  await second.return(undefined);
  const allocated = store.stats().end;
  const segments = [];
  for await (const segment of font!.glyphSegments(1)) segments.push(segment);
  expect(segments).toEqual(triangleFont().getGlyphOutlineByGid(1));
  expect(store.stats().end).toBe(allocated);
});

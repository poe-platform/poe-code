import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import {
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  dictSet,
  type PdfPixelStorage,
  type PdfPlacedGlyph
} from "../ast.js";
import { renderDisplayListToBitmap, renderOperationStreamWindow } from "../render/raster.js";
import { StoredMetadataStack } from "./stored-record.js";

it.each([
  "1 0 0 rg q 0 1 0 rg q 0 0 1 rg 1 1 6 6 re f Q 8 1 6 6 re f Q 1 8 6 6 re f",
  "/G gs q BT /F2 5 Tf 1 0 0 1 1 1 Tm (B) Tj ET Q BT 1 0 0 1 2 7 Tm (A) Tj ET",
  "/Span << /MCID 7 /ActualText (outer) >> BDC BT /F1 5 Tf 1 0 0 1 1 1 Tm (A) Tj ET /Span << /MCID 8 /ActualText (inner) >> BDC BT 1 0 0 1 5 1 Tm (B) Tj ET EMC BT 1 0 0 1 9 1 Tm (C) Tj ET EMC",
  "q /Span BMC 1 1 12 12 re f"
])("restores stored graphics, font and marked-content state: %s", async (content) => {
  const original = PdfDocument.create(),
    page = original.addPage(),
    nums = (v: number[]) => cosArray(v.map((n) => cosNumber(n)));
  dictSet(page.pageDict, "MediaBox", nums([0, 0, 16, 16]));
  const font = (name: string) =>
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName(name) }),
    helvetica = original.cos.allocateObject(font("Helvetica"));
  dictSet(
    page.pageDict,
    "Resources",
    cosDict({
      Font: cosDict({ F1: helvetica, F2: font("Courier") }),
      ExtGState: cosDict({ G: cosDict({ Font: cosArray([helvetica, cosNumber(8)]) }) })
    })
  );
  dictSet(
    page.pageDict,
    "Contents",
    original.cos.allocateObject(cosStream(new TextEncoder().encode(content)))
  );
  const display = page.evaluateDisplayList(),
    expected = renderDisplayListToBitmap(display, { scale: 1, transparent: true });
  const metadata = (glyph: PdfPlacedGlyph) => ({
    unicode: glyph.unicode,
    fontName: glyph.fontName,
    matrix: glyph.matrix,
    bbox: glyph.bbox,
    actualText: glyph.actualText,
    mcid: glyph.mcid,
    color: glyph.color
  });
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/input", original.save());
  const index = { fs, directory: "/scratch" },
    source = await PdfFileSource.open(fs, "/input"),
    document = await PdfRetainedDocument.open(source, index);
  const bytes = new Uint8Array(2 ** 20);
  let end = 0;
  const storage: PdfPixelStorage = {
    allocate(n) {
      const at = end;
      end += n;
      return at;
    },
    async read(at, n) {
      return bytes.subarray(at, at + n);
    },
    async write(at, b) {
      bytes.set(b, at);
    }
  };
  try {
    const retained = (await document.pages().next()).value!,
      glyphs: ReturnType<typeof metadata>[] = [];
    const actual = await renderOperationStreamWindow(
      { width: 16, height: 16 },
      async function* () {
        for await (const event of retained.evaluateSteps(index, { imageStorage: storage })) {
          if (event.operation.kind === "glyph") glyphs.push(metadata(event.operation.value));
          if (!event.captured) yield event.operation;
        }
      },
      { x: 0, y: 0, width: 16, height: 16 },
      { scale: 1, transparent: true }
    );
    expect(actual.data).toEqual(expected.data);
    expect(glyphs).toEqual(display.glyphs.map(metadata));
  } finally {
    await document.close();
    await source.close();
    expect(await fs.readdir("/scratch")).toEqual([]);
  }
});

it("keeps independent metadata stacks in caller storage and preserves borrowed reads", async () => {
  const bytes = new Uint8Array(2 ** 20),
    scratch = new Uint8Array(4096);
  let end = 0,
    peak = 0;
  const storage: PdfPixelStorage = {
    allocate(n) {
      const at = end;
      end += n;
      return at;
    },
    async read(at, n) {
      peak = Math.max(peak, n);
      scratch.set(bytes.subarray(at, at + n));
      return scratch.subarray(0, n);
    },
    async write(at, b) {
      peak = Math.max(peak, b.length);
      bytes.set(b, at);
    }
  };
  const first = new StoredMetadataStack<{ value: number }>(storage),
    second = new StoredMetadataStack<string>(storage);
  for (let i = 0; i < 256; i++) {
    await first.push({ value: i });
    await second.push(String(i));
  }
  for (let i = 255; i >= 0; i--) {
    expect(await first.pop()).toEqual({ value: i });
    expect(await second.pop()).toBe(String(i));
  }
  expect(first.length).toBe(0);
  expect(second.length).toBe(0);
  expect(await first.pop()).toBeUndefined();
  expect(peak).toBeLessThanOrEqual(4096);
  const reason = { reason: "cancel frames" },
    controller = new AbortController();
  controller.abort(reason);
  const stopped = new StoredMetadataStack(storage, controller.signal);
  await expect(stopped.push({})).rejects.toBe(reason);
  await expect(stopped.pop()).rejects.toBe(reason);
});

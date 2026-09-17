import { beforeAll, expect, it, vi } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package/zip";
import { createCompressionCodec } from "@poe-code/office-package/compression";
import { suppliedDefaultFont } from "@poe-code/pdf";
import { convert, createFormatRegistry, writeDocument } from "./index.js";
import { createExecutionContext } from "./execution.js";
import type { Document, Limits } from "./types.js";

const encode = (text: string) => new TextEncoder().encode(text);
const immediate = async () => {};
const zipLimits: ZipLimits = { maxArchiveBytes: 1_000_000, maxEntryBytes: 100_000,
  maxTotalBytes: 1_000_000, maxMembers: 64, maxPathBytes: 1024, maxDepth: 32,
  maxPaxBytes: 4096, maxTextBytes: 100_000, chunkSize: 4096 };
const codec = createZipCodec({ compression: createCompressionCodec(), yieldTurn: immediate,
  fail: message => { throw new Error(message); } });
async function zip(parts: Record<string, string>): Promise<Uint8Array> {
  const signal = new AbortController().signal;
  const entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await codec.makeZipEntry(name, encode(text), {
    compression: "deflate", modified: new Date("2000-01-01T00:00:00Z"), mode: 0o644,
    directory: false, symlink: false
  }, zipLimits, signal));
  return codec.writeZipArchive({ entries, comment: new Uint8Array() }, zipLimits, signal);
}
function book(): Record<string, string> {
  return {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "book.opf": '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Original stress</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    "a.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Original A</p></body></html>',
    "b.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Original B</p></body></html>'
  };
}

it.each([
  ["compressedBytes", 16], ["expandedBytes", 1024], ["parts", 2], ["resourceBytes", 1024]
] as const)("rejects original compressed EPUB amplification at %s before writing", async (key, budget) => {
  const parts = book(); parts["padding"] = "a".repeat(32768);
  const bytes = await zip(parts);
  expect(bytes.length).toBeLessThan(4096);
  const publish = vi.fn(immediate), resolve = vi.fn();
  await expect(convert([{ bytes }], { from: "epub", to: "plain" }, {
    limits: { [key]: budget }, output: { publish }, resources: { resolve }, yield: immediate
  })).rejects.toMatchObject({ code: "E_LIMIT" });
  expect(publish).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
});

it.each(["entity", "spine", "fallback"])("rejects EPUB %s dependency attacks without external access", async kind => {
  const parts = book();
  if (kind === "entity") parts["a.xhtml"] = '<!DOCTYPE html [<!ENTITY leak SYSTEM "https://denied.test/entity">]>' + parts["a.xhtml"];
  if (kind === "spine") parts["book.opf"] = parts["book.opf"]!.replace('<itemref idref="b"/>', '<itemref idref="a"/>');
  if (kind === "fallback") parts["book.opf"] = parts["book.opf"]!.replace('id="a"', 'fallback="b" id="a"').replace('id="b"', 'fallback="a" id="b"');
  const publish = vi.fn(immediate), resolve = vi.fn();
  await expect(convert([{ bytes: await zip(parts) }], { from: "epub", to: "plain" }, {
    output: { publish }, resources: { resolve }, yield: immediate
  })).rejects.toMatchObject({ code: "E_PARSE" });
  expect(publish).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
});

it("cancels the direct EPUB decompressor at a cooperative checkpoint", async () => {
  const parts = book(); parts["padding"] = "a".repeat(32768);
  const bytes = await zip(parts);
  const controller = new AbortController();
  const yieldTurn = vi.fn(async () => { controller.abort(); });
  const context = createExecutionContext("read", { signal: controller.signal, yield: yieldTurn });
  const selection = createFormatRegistry().resolve("epub", "read");
  await expect(selection.reader!.read({ bytes }, context, selection)).rejects.toMatchObject({ code: "E_CANCELLED" });
  expect(yieldTurn).toHaveBeenCalledTimes(1);
  await context.close();
});

const document: Document = { blocks: [{ t: "Para", c: [{ t: "Str", c: "Original" }] }], metadata: {}, resources: [] };
let presentation: Uint8Array;
beforeAll(async () => {
  const result = await writeDocument(document, { to: "pptx" }, { yield: immediate });
  if (result.kind !== "binary") throw new Error("PPTX required");
  presentation = result.bytes;
});
it.each([
  ["compressedBytes", 16], ["expandedBytes", 1024], ["parts", 2],
  ["resourceBytes", 1024],
  ["binaryBytes", 1024], ["xmlDepth", 1], ["xmlNodes", 2], ["references", 2]
] as const)("passes %s admission to the enabled Office adapter's public sibling API", async (key, budget) => {
  const publish = vi.fn(immediate);
  await expect(convert([{ bytes: presentation }], { from: "pptx", to: "plain" }, {
    limits: { [key]: budget }, output: { publish }, yield: immediate
  })).rejects.toMatchObject({ code: "E_LIMIT" });
  expect(publish).not.toHaveBeenCalled();
});

it("cancels between direct PPTX public sibling API acquisitions", async () => {
  const controller = new AbortController();
  const selection = createFormatRegistry().resolve("pptx", "read");
  const context = createExecutionContext("read", {
    signal: controller.signal, yield: immediate
  });
  const bound = context.bound.bind(context);
  vi.spyOn(context, "bound").mockImplementation((key, amount) => {
    bound(key, amount);
    if (key === "pages") controller.abort();
  });
  // A deterministic acquisition boundary cancels the signal passed to the
  // next sibling API call, without depending on timers or document size.
  await expect(selection.reader!.read({ bytes: presentation }, context, selection))
    .rejects.toMatchObject({ code: "E_CANCELLED" });
  await context.close();
});

it.each(["directory", "glyph-location", "glyph-index", "zero-advance"])("refuses original malformed PDF font %s before publication", async kind => {
  const bytes = new Uint8Array(suppliedDefaultFont().bytes), view = new DataView(bytes.buffer);
  if (kind === "directory") view.setUint16(4, 65535);
  else {
    for (let i = 0; i < view.getUint16(4); i++) {
      const record = 12 + i * 16;
      if (view.getUint32(record) === 0x6c6f6361) {
        const start = view.getUint32(record + 8);
        if (kind === "glyph-location") view.setUint32(start, 0xffffffff);
      }
      if (kind === "zero-advance" && view.getUint32(record) === 0x686d7478) {
        const start = view.getUint32(record + 8), size = view.getUint32(record + 12);
        bytes.fill(0, start, start + size);
      }
      if (kind === "glyph-index" && view.getUint32(record) === 0x636d6170) {
        const base = view.getUint32(record + 8);
        for (let j = 0; j < view.getUint16(base + 2); j++) {
          const sub = base + view.getUint32(base + 8 + j * 8);
          if (view.getUint16(sub) === 12 || view.getUint16(sub) === 13) {
            const groups = view.getUint32(sub + 12);
            for (let g = 0; g < groups; g++) {
              const at = sub + 16 + g * 12;
              if (view.getUint32(at) <= 79 && view.getUint32(at + 4) >= 79) view.setUint32(at + 8, 0xffffffff);
            }
          }
          if (view.getUint16(sub) !== 4) continue;
          const segments = view.getUint16(sub + 6) / 2;
          for (let g = 0; g < segments; g++) {
            const first = view.getUint16(sub + 16 + segments * 2 + g * 2);
            const last = view.getUint16(sub + 14 + g * 2);
            if (first <= 79 && last >= 79) view.setUint16(sub + 16 + segments * 4 + g * 2, 0x7000);
          }
        }
      }
    }
  }
  const publish = vi.fn(immediate);
  await expect(writeDocument(document, { to: "pdf", pdfFonts: [{ bytes }] }, {
    output: { publish }, yield: immediate
  })).rejects.toMatchObject({ code: "E_CAPABILITY" });
  expect(publish).not.toHaveBeenCalled();
});

it("rejects nonadvancing PDF line/page geometry without publication", async () => {
  const publish = vi.fn(immediate);
  await expect(writeDocument(document, { to: "pdf", pdfPage: { width: 30, height: 30, margin: 10 } }, {
    output: { publish }, yield: immediate
  })).rejects.toMatchObject({ code: "E_CAPABILITY", message: expect.stringContaining("exceeds page") });
  expect(publish).not.toHaveBeenCalled();
});

it.each(["glyphs", "pages", "layoutWork"] as const)("bounds PDF %s with tiny lines and pages without writes", async key => {
  const publish = vi.fn(immediate);
  await expect(writeDocument({ ...document, blocks: Array.from({ length: 16 }, () => document.blocks[0]!) }, {
    to: "pdf", pdfPage: { width: 100, height: 60, margin: 10 }
  }, { limits: { [key]: key === "pages" ? 1 : 4 } satisfies Partial<Limits>, output: { publish }, yield: immediate }))
    .rejects.toMatchObject({ code: "E_LIMIT" });
  expect(publish).not.toHaveBeenCalled();
});

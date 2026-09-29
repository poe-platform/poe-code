import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosDict, cosName, cosStream, dictGet, dictSet } from "../ast.js";
import { stringToBytes } from "../bytes.js";
import { PdfDocument } from "../document.js";
import { parseCosDocument } from "./parser.js";

function rawDocument(info: string, options: { compressed?: boolean; scan?: boolean; trailer?: string } = {}) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 0 /Kids [] >>"];
  const data = `4 0 ${info}`;
  objects.push(options.compressed ? `<< /Type /ObjStm /N 1 /First 4 /Length ${data.length} >>\nstream\n${data}\nendstream` : info);
  let text = "%PDF-1.7\n";
  const offsets = objects.map((body, i) => {
    const offset = text.length;
    text += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xrefOffset = text.length;
  if (options.compressed) {
    const entries = new Uint8Array(5 * 7);
    const view = new DataView(entries.buffer);
    for (let i = 0; i < 5; i++) {
      entries[i * 7] = i === 3 ? 2 : 1;
      view.setUint32(i * 7 + 1, i === 3 ? 3 : i === 4 ? xrefOffset : offsets[i]!);
    }
    text += `5 0 obj\n<< /Type /XRef /Size 6 /W [1 4 2] /Index [1 5] /Root 1 0 R /Info 4 0 R /Length ${entries.length} >>\nstream\n`;
    text += String.fromCharCode(...entries) + "\nendstream\nendobj\n";
  } else {
    text += `xref\n0 4\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("")}`;
    text += `trailer\n<< /Size 4 /Root 1 0 R /Info 3 0 R ${options.trailer ?? ""} >>\n`;
  }
  return stringToBytes(text + `startxref\n${options.scan ? 0 : xrefOffset}\n%%EOF\n`);
}

describe("malformed dictionary key recovery", () => {
  // PDF.js Parser.getObj skips non-Name tokens in dictionary-key positions.
  // issue11549 uses this to retain embedded fonts with an unescaped font name.
  it.each(["MS", "17", "true", "false", "null", "(junk)", "<AB>", "MS 17 false (junk)"])("retains valid entries after stray %s", garbage => {
    const bytes = rawDocument(`<< /BaseFont /Arial,Unicode ${garbage} /Title (Retained) >>`);
    const doc = parseCosDocument(bytes, { recovery: "repair" });
    expect(doc.getInfoString("Title")).toBe("Retained");
    expect(dictGet(doc.resolveDict(doc.infoRef)!, "BaseFont")).toMatchObject({ kind: "name", decoded: "Arial,Unicode" });
  });

  it("continues rejecting malformed dictionary keys in strict mode", () => {
    expect(() => parseCosDocument(rawDocument("<< /BaseFont /Arial,Unicode MS /Title (Retained) >>")))
      .toThrow("Expected dictionary key /Name");
  });

  it.each([false, true])("repairs compressed dictionaries (scan=%s)", scan => {
    const doc = parseCosDocument(rawDocument("<< /BaseFont /Arial,Unicode MS /Title (Compressed) >>", { compressed: true, scan }), { recovery: "repair" });
    expect(doc.getInfoString("Title")).toBe("Compressed");
  });

  it("retains malformed trailer metadata during full-file recovery", () => {
    const doc = parseCosDocument(rawDocument("<< /Title (Retained) >>", { scan: true, trailer: "junk /ID [<1234> <1234>]" }), { recovery: "repair" });
    expect(doc.getInfoString("Title")).toBe("Retained");
    expect(doc.idArray?.items).toHaveLength(2);
  });

  it("keeps syntax-depth limits while recovering dictionary keys", () => {
    const bytes = rawDocument("<< junk /Nested << junk /Nested << /Value 1 >> >> >>");
    expect(() => parseCosDocument(bytes, { recovery: "repair", maxRecursionDepth: 1 }))
      .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
  });

  it("retains PDF.js issue11549's fonts and visible glyphs", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue11549_reduced.pdf", import.meta.url))));
    expect(doc.cos.getObject(70)).toMatchObject({ kind: "dict" });
    const glyphs = doc.getPage(0).evaluateDisplayList().glyphs;
    expect(glyphs).toHaveLength(16);
    const bitmap = doc.getPage(0).renderToBitmap({ dpi: 72 });
    expect(bitmap.data.filter((value, index) => index % 4 === 0 && value < 128).length).toBeGreaterThan(400);
    expect(PdfDocument.load(doc.save()).getPage(0).renderToBitmap({ dpi: 72 })).toEqual(bitmap);
  });

  it.each([false, true])("ignores a broken optional ToUnicode map but retains explicit decode limits (limited=%s)", limited => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);
    page.drawText("Hello", { x: 10, y: 20 });
    const resources = doc.cos.resolveDict(dictGet(page.pageDict, "Resources"))!;
    const fonts = doc.cos.resolveDict(dictGet(resources, "Font"))!;
    const font = doc.cos.resolveDict(fonts.entries[0]!.value)!;
    const cmap = limited
      ? cosStream(new TextEncoder().encode(" ".repeat(256)), { compress: true })
      : cosStream(new Uint8Array([120, 156, 7]), { dict: cosDict({ Filter: cosName("FlateDecode") }) });
    dictSet(font, "ToUnicode", doc.cos.allocateObject(cmap));
    const loaded = PdfDocument.load(doc.save(), { maxDecompressedBytes: limited ? 128 : Infinity });
    if (limited) {
      expect(() => loaded.getPage(0).evaluateDisplayList()).toThrow(expect.objectContaining({ code: "E_LIMIT" }));
    } else {
      expect(loaded.extractText().trim()).toBe("Hello");
      expect(loaded.getPage(0).evaluateDisplayList().glyphs.every(glyph => glyph.outline)).toBe(true);
    }
  });
});

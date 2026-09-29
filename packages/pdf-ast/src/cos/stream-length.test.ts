import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PdfDocument } from "../document.js";
import { parseCosDocument } from "./parser.js";

const encode = (text: string) => new TextEncoder().encode(text);
function streamDocument(data: string, length: number, indirect = false) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 0 /Kids [] >>",
    `<< /Length ${indirect ? "4 0 R" : length} >>\nstream\n${data}\nendstream`, String(length),
  ];
  let text = "%PDF-1.7\n";
  const offsets = objects.map((body, index) => {
    const offset = text.length;
    text += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = text.length;
  text += `xref\n0 5\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("")}`;
  return encode(text + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

describe("PDF.js stream Length recovery", () => {
  it.each([false, true])("recovers drawing commands after a short Length (indirect=%s)", indirect => {
    const data = "500 0 0 400 0 0 cm\n/SomeImage Do";
    const doc = parseCosDocument(streamDocument(data, 14, indirect));
    expect(doc.getObject(3)).toMatchObject({ kind: "stream", rawBytes: encode(data) });
  });

  it.each(["(unterminated", "<not-hex", "endstreaming", "abc\u0001def"])("recovers when the claimed end points into %s", tail => {
    const data = `abc${tail}`;
    expect(parseCosDocument(streamDocument(data, 3)).getObject(3)).toMatchObject({ kind: "stream", rawBytes: encode(data) });
  });

  it("trusts an accurate Length when the data contains endstream/endobj text", () => {
    const data = "prefix\nendstream\nendobj\nsuffix";
    expect(parseCosDocument(streamDocument(data, data.length)).getObject(3)).toMatchObject({ kind: "stream", rawBytes: encode(data) });
  });

  it("renders and saves PDF.js's unchanged xobject-image fixture", () => {
    const bytes = new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-xobject-image.pdf", import.meta.url)));
    const doc = PdfDocument.load(bytes);
    const bitmap = doc.getPage(0).renderToBitmap({ scale: 1 });
    expect([bitmap.width, bitmap.height]).toEqual([200, 100]);
    expect(Array.from(bitmap.data.slice(0, 4))).toEqual([254, 0, 0, 255]);
    expect(Array.from(bitmap.data.slice(-4))).toEqual([254, 0, 0, 255]);
    expect(PdfDocument.load(doc.save()).getPage(0).renderToBitmap({ scale: 1 })).toEqual(bitmap);
  });
});

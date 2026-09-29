import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dictGet } from "../ast.js";
import { stringToBytes } from "../bytes.js";
import { parseCosDocument } from "./parser.js";

function xrefStream(widths: string, index: string, data: number[], size = "3") {
  const prefix = "%PDF-1.5\n2 0 obj\n<< /Type /Catalog >>\nendobj\n";
  return stringToBytes(prefix + `1 0 obj\n<< /Type /XRef /W ${widths} /Index ${index} /Size ${size} /Root 2 0 R /Length ${data.length} >>\nstream\n` +
    String.fromCharCode(...data) + `\nendstream\nendobj\nstartxref\n${prefix.length}\n%%EOF\n`);
}

describe("xref stream validation", () => {
  // Fixture ported unchanged from PDF.js test/unit/document_spec.js, XRef suite,
  // at 91041fb94d6744bc2a5bccd9aad28d617faa8195 (Apache-2.0).
  it("rejects an xref stream whose entries have zero width", () => {
    const bytes = stringToBytes("%PDF-1.5\n" + "1 0 obj\n" +
      "<</Type/XRef/W[0 0 0]/Index[0 10000000]/Size 10000001" + "/Root 2 0 R/Length 0>>\n" +
      "stream\nendstream\nendobj\n" + "startxref\n9\n%%EOF\n");
    expect(() => parseCosDocument(bytes)).toThrow("Invalid XRef entry fields length");
  });

  it.each(["[0 0 0]", "[1 -1 1]", "[1 0.5 1]", "[1 /Unknown 1]", "[1 1]"])("validates field widths %s even with no entries", widths => {
    expect(() => parseCosDocument(xrefStream(widths, "[0 0]", []))).toThrow("Invalid XRef entry fields length");
  });

  it.each(["[0 -1]", "[0.5 1]", "[0 1.5]", "[2 1 3]", "/Unknown"])("validates index ranges %s", index => {
    expect(() => parseCosDocument(xrefStream("[0 1 0]", index, [9]))).toThrow("Invalid XRef range");
  });

  it.each(["-1", "0.5", "9007199254740992"])("validates Size %s", size => {
    expect(() => parseCosDocument(xrefStream("[0 1 0]", "[2 1]", [9], size))).toThrow("Invalid XRef stream Size");
  });

  it("rejects truncated entries instead of accepting a partial table", () => {
    expect(() => parseCosDocument(xrefStream("[0 1 0]", "[2 2]", [9]))).toThrow("Truncated XRef stream");
  });

  it("rejects unknown entry types", () => {
    expect(() => parseCosDocument(xrefStream("[1 1 0]", "[2 1]", [3, 9]))).toThrow("Invalid XRef entry type");
  });

  it("keeps zero-width default type and generation fields", () => {
    const doc = parseCosDocument(xrefStream("[0 1 0]", "[2 1]", [9]));
    expect(doc.getObject(2)).toMatchObject({ kind: "dict" });
    expect(doc.rootRef.objectNumber).toBe(2);
  });

  it("repairs PDF.js issue18986 after rejecting its damaged XRef entries", () => {
    const bytes = new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue18986.pdf", import.meta.url)));
    const doc = parseCosDocument(bytes, { recovery: "repair" });
    const catalog = doc.resolveDict(doc.rootRef)!;
    const pages = doc.resolveDict(dictGet(catalog, "Pages"))!;
    expect(dictGet(catalog, "Type")).toMatchObject({ decoded: "Catalog" });
    expect(dictGet(pages, "Count")).toMatchObject({ value: 1 });
  });

  it("bounds classic xref tables before following object offsets", () => {
    const bytes = stringToBytes("%PDF-1.7\nxref\n1 20\n" + "0000000999 00000 n \n".repeat(20) + "trailer\n<< /Size 21 /Root 2 0 R >>\nstartxref\n9\n%%EOF");
    expect(() => parseCosDocument(bytes, { maxObjects: 2 })).toThrow(expect.objectContaining({ code: "E_LIMIT" }));
  });

  it("applies object limits before following invalid xref offsets", () => {
    expect(() => parseCosDocument(xrefStream("[0 1 0]", "[1 20]", new Array<number>(20).fill(255)), { maxObjects: 2 }))
      .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
  });
});

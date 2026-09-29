// Recovery cases follow PDF.js XRef.indexObjects and its issue15893 fixture.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosDict, cosName, cosNumber, cosRef, cosStream, dictGet } from "../ast.js";
import { bytesToString, stringToBytes } from "../bytes.js";
import { PdfDocument } from "../document.js";
import { ParsedCosDocument, parseCosDocument } from "./parser.js";
import { encryptCosDocument } from "./security.js";
import { serializeCosNodeBytes } from "./writer.js";

const upstream = new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue15893_reduced.pdf", import.meta.url)));
function damageXref(bytes: Uint8Array) {
  const text = bytesToString(bytes);
  return stringToBytes(text.slice(0, text.lastIndexOf("startxref")) + "startxref\n999999999\n%%EOF\n");
}

function encryptedObjectStream(directEncrypt = false, xrefStream = false) {
  const bodies = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 0 /Kids [] >>", "<< /Title (Recovered packed title) >>"];
  let offset = 0;
  const header = bodies.map((body, index) => { const entry = `${index + 1} ${offset} `; offset += body.length + 1; return entry; }).join("");
  const stream = cosStream(stringToBytes(header + bodies.join(" ")), { dict: cosDict({ Type: cosName("ObjStm"), N: cosNumber(3), First: cosNumber(header.length) }), compress: true });
  const doc = new ParsedCosDocument({ version: "1.7", bytes: new Uint8Array(), revisions: [], rootRef: cosRef(1), infoRef: cosRef(3),
    objects: new Map([[7, { objectNumber: 7, generationNumber: 0, value: stream }]]) });
  const bytes = encryptCosDocument(doc, { revision: 3, userPassword: "user", ownerPassword: "owner" });
  // The strict parser authenticates without unpacking unindexed compressed objects.
  const parsed = parseCosDocument(bytes, { password: "user" });
  let text = bytesToString(bytes);
  if (directEncrypt) text = text.replace(`/Encrypt ${parsed.encryptRef!.objectNumber} 0 R`, `/Encrypt ${bytesToString(serializeCosNodeBytes(parsed.resolveDict(parsed.encryptRef)!))}`);
  if (xrefStream) {
    const trailerStart = text.lastIndexOf("trailer");
    const trailer = text.slice(trailerStart + 7, text.lastIndexOf("startxref")).trim();
    text = text.slice(0, text.lastIndexOf("\nxref")) + `\n9 0 obj\n${trailer.slice(0, -2)} /Type /XRef /Length 0 >>\nstream\n\nendstream\nendobj\n`;
  }
  return damageXref(stringToBytes(text + (xrefStream ? "startxref\n0\n" : "")));
}

describe("encrypted xref recovery", () => {
  it("uses the encrypted trailer in PDF.js issue15893_reduced", () => {
    const doc = PdfDocument.load(upstream, { password: "test" });
    expect(doc.cos.encryption?.revision).toBe(3);
    expect(doc.getPage(0).extractText()).toContain("Issue 15893 - password");
    expect(doc.cos.idArray?.items).toHaveLength(2);
  });

  it.each(["", "wrong"])("rejects password %j while recovering the upstream document", password => {
    expect(() => PdfDocument.load(upstream, { password })).toThrow("Invalid PDF password");
  });

  it.each([false, true])("recovers PDF.js direct-Encrypt fixture with damaged xref (%s)", second => {
    const bytes = new Uint8Array(readFileSync(new URL(`../fixtures/pdfjs-issue6010_${second ? 2 : 1}.pdf`, import.meta.url)));
    const doc = PdfDocument.load(damageXref(bytes), { password: second ? "æøå" : "abc" });
    expect(doc.extractText()).toContain("Issue 6010");
    expect(doc.cos.encryption).toBeDefined();
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])("decrypts before unpacking ObjStm (direct=%s, xref stream=%s)", (direct, xrefStream) => {
    const doc = parseCosDocument(encryptedObjectStream(direct, xrefStream), { password: "owner", recovery: "repair" });
    expect(dictGet(doc.resolveDict(doc.rootRef)!, "Type")).toMatchObject({ decoded: "Catalog" });
    expect(doc.getInfoString("Title")).toBe("Recovered packed title");
    expect(doc.encryption?.revision).toBe(3);
  });

  it("skips a later encrypted trailer whose Root is a Pages dictionary", () => {
    const text = bytesToString(upstream);
    const trailer = text.slice(text.lastIndexOf("trailer"), text.lastIndexOf("startxref")).replace("/Root 1 0 R", "/Root 2 0 R");
    const bytes = stringToBytes(text + "\n" + trailer + "\nstartxref\n999999999\n%%EOF");
    expect(PdfDocument.load(bytes, { password: "test" }).extractText()).toContain("Issue 15893 - password");
  });

  it("keeps strict mode rejecting the damaged upstream xref", () => {
    expect(() => parseCosDocument(upstream, { password: "test", recovery: "strict" })).toThrow();
  });

  it("preserves the decompression budget after authenticating a repaired stream", () => {
    expect(() => parseCosDocument(encryptedObjectStream(), { password: "user", recovery: "repair", maxDecompressedBytes: 1 }))
      .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
  });
});

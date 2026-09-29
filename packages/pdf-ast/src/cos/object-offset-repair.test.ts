import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosString } from "../ast.js";
import { bytesToString, stringToBytes } from "../bytes.js";
import { PdfDocument } from "../document.js";
import { parseCosDocument } from "./parser.js";
import { encryptCosDocument } from "./security.js";
import { serializeCosDocument } from "./writer.js";

function damagedObjectEntry(kind: "offset" | "identity" | "generation", encrypted = false) {
  let bytes = serializeCosDocument({ objects: [
    { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
    { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) }) },
    { objectNumber: 3, generationNumber: 0, value: cosDict({ Title: cosString("Recovered object offsets") }) },
  ], rootRef: cosRef(1), infoRef: cosRef(3) });
  if (encrypted) bytes = encryptCosDocument(parseCosDocument(bytes), { revision: 3, userPassword: "secret" });
  const text = bytesToString(bytes);
  const xref = text.lastIndexOf("\nxref");
  const lines = text.slice(xref).split("\n");
  // Header, subsection, free entry, then indirect object 1.
  const fields = lines[4]!.split(" ");
  if (kind === "generation") fields[1] = "00001";
  else fields[0] = String(kind === "identity" ? text.indexOf("2 0 obj") : text.indexOf("1 0 obj") + 4).padStart(10, "0");
  lines[4] = fields.join(" ");
  return stringToBytes(text.slice(0, xref) + lines.join("\n"));
}

describe("uncompressed xref object recovery", () => {
  it.each(["offset", "identity", "generation"] as const)("rejects an invalid %s in strict mode", kind => {
    expect(() => parseCosDocument(damagedObjectEntry(kind))).toThrow();
  });

  it.each(["offset", "identity", "generation"] as const)("recovers an invalid %s without losing trailer metadata", kind => {
    const doc = parseCosDocument(damagedObjectEntry(kind), { recovery: "repair" });
    expect(doc.getInfoString("Title")).toBe("Recovered object offsets");
    expect(doc.getObject(doc.rootRef.objectNumber)).toMatchObject({ kind: "dict", entries: expect.arrayContaining([
      expect.objectContaining({ value: expect.objectContaining({ kind: "name", decoded: "Catalog" }) }),
    ]) });
  });

  it("recovers PDF.js issue9418 after its invalid uncompressed xref entry", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue9418.pdf", import.meta.url))));
    expect(doc.pageCount).toBe(1);
    const display = doc.getPage(0).evaluateDisplayList();
    expect(display.paths.length + display.images.length + display.glyphs.length).toBeGreaterThan(0);
  });

  it("authenticates and decrypts after repairing an encrypted object offset", () => {
    const bytes = damagedObjectEntry("offset", true);
    expect(() => parseCosDocument(bytes, { recovery: "repair", password: "wrong" })).toThrow("Invalid PDF password");
    const doc = parseCosDocument(bytes, { recovery: "repair", password: "secret" });
    expect(doc.encryption?.revision).toBe(3);
    expect(doc.getInfoString("Title")).toBe("Recovered object offsets");
  });

  it("retains explicit object limits while repairing offsets", () => {
    expect(() => parseCosDocument(damagedObjectEntry("offset"), { recovery: "repair", maxObjects: 1 }))
      .toThrow(expect.objectContaining({ code: "E_LIMIT" }));
  });
});

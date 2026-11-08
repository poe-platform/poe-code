import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNull, cosNumber, cosRef } from "../ast.js";
import { bytesToString, stringToBytes } from "../bytes.js";
import { PdfDocument } from "../document.js";
import { parseCosDocument } from "./parser.js";
import { serializeCosDocument } from "./writer.js";

function emptyIndirectObject() {
  const bytes = serializeCosDocument({ objects: [
    { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
    { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) }) },
    { objectNumber: 3, generationNumber: 0, value: cosNull() },
  ], rootRef: cosRef(1) });
  return stringToBytes(bytesToString(bytes).replace("3 0 obj\nnull", "3 0 obj\n    "));
}

describe("empty indirect object recovery", () => {
  it("treats an empty indirect body as null in repair mode", () => {
    const doc = parseCosDocument(emptyIndirectObject(), { recovery: "repair" });
    expect(doc.getObject(3)).toMatchObject({ kind: "null" });
    expect(doc.rootRef.objectNumber).toBe(1);
  });

  it("keeps rejecting an empty body in strict mode", () => {
    expect(() => parseCosDocument(emptyIndirectObject(), { recovery: "strict" })).toThrow();
  });

  it("renders PDF.js bug1782186 despite its unused dummy objects", () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-bug1782186.pdf", import.meta.url))), { password: "Hello" });
    expect(doc.pageCount).toBe(1);
    expect(doc.getPage(0).evaluateDisplayList().paths).toHaveLength(1);
  });
});

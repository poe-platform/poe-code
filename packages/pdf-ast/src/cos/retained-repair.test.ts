import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { cosDict, cosName, cosNumber, cosRef, cosStream } from "../ast.js";
import { ParsedCosDocument } from "./parser.js";
import { encryptCosDocument } from "./security.js";
import { PdfFileSource } from "../source.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { bytesToString, stringToBytes } from "../bytes.js";

async function fixture(bytes: Uint8Array, password?: string) {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const input = { capabilities: { retainedRead: true }, openReadFile: async () => ({
    stat: async () => ({ type: "file", size: bytes.length }), close: async () => {},
    read: async (at: number, count: number) => bytes.slice(at, at + count),
  }) } as unknown as FileSystem;
  const source = await PdfFileSource.open(input, "/input", { chunkBytes: 128, cacheBytes: 256 });
  return { source, fs, open: () => PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { recovery: "repair", chunkBytes: 128, cacheBytes: 256, ...(password ? { password } : {}) }),
    async close() { expect(await fs.readdir("/scratch")).toEqual([]); await source.close(); } };
}
function damage(bytes: Uint8Array) { const text = bytesToString(bytes); return stringToBytes(text.slice(0, text.lastIndexOf("startxref")) + "startxref\n999999999\n%%EOF"); }

describe("retained document repair", () => {
  it("opens damaged and missing xrefs using caller-backed discovered objects", async () => {
    const original = PdfDocument.create(); original.addPage(); original.setMetadata({ title: "repaired" });
    for (const bytes of [damage(original.save()), stringToBytes(bytesToString(original.save()).split("\nxref")[0]!)]) {
      const f = await fixture(bytes); const doc = await f.open();
      expect((await doc.info()).Title).toBe("repaired");
      let pages = 0; for await (const ignored of doc.pages()) { void ignored; pages++; } expect(pages).toBe(1);
      await doc.close(); await f.close();
    }
  });

  it("recovers a wrong page offset even when the xref itself parses", async () => {
    const original = PdfDocument.create(); original.addPage();
    const saved = original.save(); const expected = PdfDocument.load(saved);
    const number = expected.getPage(0).pageRef.objectNumber;
    const offset = expected.cos.objects.get(number)!.span!.start;
    const bytes = stringToBytes(bytesToString(saved).replace(`${String(offset).padStart(10, "0")} 00000 n`, "0000000001 00000 n"));
    expect(bytes).not.toEqual(saved);
    const f = await fixture(bytes); const doc = await f.open();
    expect((await doc.pages().next()).value?.index).toBe(0);
    await doc.close(); await f.close();
  });

  it.each([["pdfjs-issue15893_reduced.pdf", "test"], ["pdfjs-issue6010_1.pdf", "abc"], ["pdfjs-issue6010_2.pdf", "æøå"]])("retains authentication and page traversal for %s", async (name, password) => {
    const bytes = damage(new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url))));
    const expected = PdfDocument.load(bytes, { password });
    const f = await fixture(bytes, password); const doc = await f.open();
    let pages = 0; for await (const ignored of doc.pages()) { void ignored; pages++; } expect(pages).toBe(expected.getPageCount());
    expect(doc.encryption?.revision).toBe(expected.cos.encryption?.revision);
    await doc.close(); await f.close();
  });

  it("authenticates before discovering encrypted compressed catalog and metadata", async () => {
    const bodies = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 0 /Kids [] >>", "<< /Title (packed title) >>"];
    let offset = 0;
    const header = bodies.map((body, i) => { const entry = `${i + 1} ${offset} `; offset += body.length + 1; return entry; }).join("");
    const stream = cosStream(stringToBytes(header + bodies.join(" ")), { dict: cosDict({ Type: cosName("ObjStm"), N: cosNumber(3), First: cosNumber(header.length) }), compress: true });
    const input = new ParsedCosDocument({ version: "1.7", bytes: new Uint8Array(), revisions: [], rootRef: cosRef(1), infoRef: cosRef(3),
      objects: new Map([[7, { objectNumber: 7, generationNumber: 0, value: stream }]]) });
    const bytes = damage(encryptCosDocument(input, { revision: 3, userPassword: "user", ownerPassword: "owner" }));
    const f = await fixture(bytes, "owner"); const doc = await f.open();
    expect((await doc.info()).Title).toBe("packed title"); expect((await doc.pages().next()).done).toBe(true);
    await doc.close(); await f.close();
  });

  it("ignores a later trailer pointing at a Pages dictionary", async () => {
    const input = bytesToString(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue15893_reduced.pdf", import.meta.url))));
    const trailer = input.slice(input.lastIndexOf("trailer"), input.lastIndexOf("startxref")).replace("/Root 1 0 R", "/Root 2 0 R");
    const f = await fixture(stringToBytes(input + "\n" + trailer + "\nstartxref\n999999999\n"), "test");
    const doc = await f.open(); expect(doc.crossReference.rootRef.objectNumber).toBe(1);
    await doc.close(); await f.close();
  });

  it("cleans indexes when no catalog can be recovered", async () => {
    const f = await fixture(stringToBytes("%PDF-1.7\n1 0 obj true endobj"));
    await expect(f.open()).rejects.toThrow("no /Type /Catalog"); await f.close();
  });

  it("uses file-order precedence for duplicate packed identities", async () => {
    const packed = (number: number, title: string) => {
      const body = `<< /Title (${title}) >>`; const header = "3 0 ";
      return `${number} 0 obj << /Type /ObjStm /N 1 /First ${header.length} /Length ${header.length + body.length} >> stream\n${header}${body}\nendstream\nendobj\n`;
    };
    const bytes = stringToBytes("%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n" + packed(9, "first") + packed(7, "second") + "trailer << /Root 1 0 R /Info 3 0 R >>");
    const f = await fixture(bytes); const doc = await f.open(); expect((await doc.info()).Title).toBe("first");
    await doc.close(); await f.close();
  });

  it("keeps strict opening and admission failures from silently falling back", async () => {
    const original = PdfDocument.create(); original.addPage();
    const f = await fixture(damage(original.save()));
    await expect(PdfRetainedDocument.open(f.source, { fs: f.fs, directory: "/scratch" })).rejects.toThrow("startxref");
    await expect(PdfRetainedDocument.open(f.source, { fs: f.fs, directory: "/scratch" }, { recovery: "repair", xref: { maxEntries: 1 } })).rejects.toThrow("limit");
    await f.close();
  });

  it("rejects wrong passwords and cleans the recovered index", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue15893_reduced.pdf", import.meta.url)));
    const f = await fixture(bytes, "wrong"); await expect(f.open()).rejects.toThrow("password"); await f.close();
  });

  it("recovers a compressed catalog without a trailer", async () => {
    const catalog = "<< /Type /Catalog /Pages 2 0 R >>";
    const body = catalog + " << /Type /Pages /Kids [] /Count 0 >>";
    const header = `1 0 2 ${catalog.length + 1} `;
    const f = await fixture(stringToBytes(`%PDF-1.7\n7 0 obj << /Type /ObjStm /N 2 /First ${header.length} /Length ${header.length + body.length} >> stream\n${header}${body}\nendstream\nendobj`));
    const doc = await f.open(); expect(doc.crossReference.rootRef.objectNumber).toBe(1);
    expect((await doc.pages().next()).done).toBe(true); await doc.close(); await f.close();
  });
});

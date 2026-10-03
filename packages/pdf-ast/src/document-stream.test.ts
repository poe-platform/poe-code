import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, type SavePdfOptions } from "./document.js";
import { concatByteArrays } from "./cos/writer.js";

function document() {
  const doc = PdfDocument.create();
  doc.addPage().drawText("Keep document features", { x: 20, y: 20 });
  doc.setTitle("Streamed edits");
  return doc;
}

describe("PdfDocument streamed saves", () => {
  it.each<SavePdfOptions>([{}, { normalizeContent: true }, { objectStreams: "generate" }, { linearize: true }, { incremental: true }])
    ("matches buffered output for %j", async options => {
      const doc = PdfDocument.load(document().save());
      doc.setAuthor("Streaming author");
      const expected = doc.save(options);
      const fs = createMemoryFileSystem();
      await fs.mkdir("/scratch");
      const chunks: Uint8Array[] = [];
      await doc.saveTo({ write: async bytes => { expect(bytes.length).toBeLessThanOrEqual(31); chunks.push(bytes); } }, { ...options, chunkBytes: 31 }, { fs, directory: "/scratch" });
      expect(concatByteArrays(chunks)).toEqual(expected);
      expect(PdfDocument.load(concatByteArrays(chunks)).extractText()).toContain("Keep document features");
      expect(await fs.readdir("/scratch")).toEqual([]);
    });

  it.each([3, 6] as const)("retains revision %i encryption and both passwords", async revision => {
    const doc = document();
    const chunks: Uint8Array[] = [];
    await doc.saveTo({ write: async bytes => { chunks.push(bytes); } }, { encrypt: { revision, userPassword: "reader", ownerPassword: "owner" } });
    const bytes = concatByteArrays(chunks);
    for (const password of ["reader", "owner"]) {
      const opened = PdfDocument.load(bytes, { password });
      expect(opened.extractText()).toContain("Keep document features");
      expect(opened.cos.encryption?.revision).toBe(revision);
    }
    expect(() => PdfDocument.load(bytes, { password: "wrong" })).toThrow();
  });

  it("keeps destructive edits on the full rewrite path even with incremental requested", async () => {
    const doc = PdfDocument.load(document().save());
    doc.getPage(0).redact([[0, 0, 612, 792]]);
    const chunks: Uint8Array[] = [];
    await doc.saveTo({ write: async bytes => { chunks.push(bytes); } }, { incremental: true });
    const bytes = concatByteArrays(chunks);
    expect(bytes).toEqual(doc.save({ incremental: true }));
    expect(PdfDocument.load(bytes).extractText()).not.toContain("Keep document features");
  });

  it("releases linearization staging when a stream consumer stops early", async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    const iterator = document().saveStream({ linearize: true }, { fs, directory: "/scratch" });
    expect((await iterator.next()).done).toBe(false);
    expect(await fs.readdir("/scratch")).toHaveLength(1);
    await iterator.return();
    expect(await fs.readdir("/scratch")).toEqual([]);
  });

  it("cleans staged output when serialization exceeds its budget", async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    const write = vi.fn(async () => {});
    await expect(document().saveTo({ write }, { linearize: true, maxOutputBytes: 1 }, { fs, directory: "/scratch" }))
      .rejects.toMatchObject({ code: "E_LIMIT" });
    expect(write).not.toHaveBeenCalled();
    expect(await fs.readdir("/scratch")).toEqual([]);
  });

  it("retains linearization when resaving an existing linearized document", async () => {
    const doc = PdfDocument.load(document().save({ linearize: true }));
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    const chunks: Uint8Array[] = [];
    await doc.saveTo({ write: async bytes => { chunks.push(bytes); } }, {}, { fs, directory: "/scratch" });
    expect(concatByteArrays(chunks)).toEqual(doc.save());
    expect(await fs.readdir("/scratch")).toEqual([]);
  });

  it("cancels before mutating or writing a document", async () => {
    const doc = document();
    const controller = new AbortController();
    const failure = new Error("save cancelled");
    controller.abort(failure);
    const write = vi.fn(async () => {});
    await expect(doc.saveTo({ write }, { signal: controller.signal })).rejects.toBe(failure);
    expect(write).not.toHaveBeenCalled();
  });
});

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { retainedObjectOrder } from "./retained-object-order.js";
import { parseCosDocument } from "./parser.js";

// Owned one-page PDFs, independently accepted without warnings by qpdf 12.4.2.
// The stream variant was written by qpdf --object-streams=generate. Offsets
// remain relative to the PDF header, after the 14-byte leading prefix.
for (const kind of ["table", "stream", "incremental", "unindexed", "linearized"]) {
  it(`reads header-relative ${kind} offsets without reconstruction`, async () => {
    const bytes = new Uint8Array(readFileSync(new URL(`../fixtures/qpdf-prefixed-${kind}.pdf`, import.meta.url)));
    const warnings: string[] = [];
    const expected = PdfDocument.load(bytes.subarray(14));
    const buffered = parseCosDocument(bytes, { onWarning: warning => warnings.push(warning) });
    expect(buffered.revisions.length).toBe(expected.cos.revisions.length);
    expect([...buffered.objects.keys()]).toEqual([...expected.cos.objects.keys()]);
    for (const [i, revision] of buffered.revisions.entries()) {
      expect(revision.xrefOffset).toBe(expected.cos.revisions[i]!.xrefOffset + 14);
      for (const [id, row] of revision.entries) if (row.type === "uncompressed") {
        expect(row.offset).toBe(expected.cos.revisions[i]!.entries.get(id)!.offset! + 14);
        expect(Buffer.from(bytes.subarray(row.offset, row.offset! + String(id).length + 1)).toString()).toBe(`${id} `);
      }
    }
    expect(PdfDocument.load(bytes).getPage(0).getMediaBox()).toEqual(expected.getPage(0).getMediaBox());
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input.pdf", bytes);
    const source = await PdfFileSource.open(fs, "/input.pdf", { chunkBytes: 7, cacheBytes: 14 });
    try {
      const retained = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { onWarning: warning => warnings.push(warning) });
      try {
        expect(retained.crossReference.revisionCount).toBe(buffered.revisions.length);
        const order: number[] = [];
        for await (const number of retainedObjectOrder(retained, source, { fs, directory: "/scratch" }, new AbortController().signal)) order.push(number);
        expect(order).toEqual([...buffered.objects.keys()]);
        for (const [id, row] of buffered.revisions[0]!.entries) expect(await retained.crossReference.index.get(id)).toEqual(row);
        let count = 0; for await (const page of retained.pages()) { expect(page.index).toBe(0); count++; }
        expect(count).toBe(1);
      } finally { await retained.close(); }
    } finally { await source.close(); }
    expect(warnings).toEqual([]);
    expect(await fs.readdir("/scratch")).toEqual([]);
  });
}

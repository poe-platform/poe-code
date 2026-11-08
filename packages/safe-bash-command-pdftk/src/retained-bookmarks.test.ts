import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, PdfFileSource, PdfRetainedDocument, editRetainedDocument, saveRetainedDocumentChunks } from "@poe-code/pdf-ast";
import { runPdftkCli } from "./index.js";

it.each([[], [1], [1, 2, 3, 1, 3, 2, 4, 1], [8, 8, 8, 1, 2], [1, 1, 1, 1]].map(levels => ({ levels })))("retained bookmark edits preserve pdftk hierarchy and bytes for $levels", async ({ levels }) => {
  const original = PdfDocument.create(); original.addPage(); original.addPage(); original.addPage();
  const bytes = original.save(), bookmarks = levels.map((level, index) => ({ title: `Chapter ${index}`, level, pageNumber: index - 1 }));
  const text = bookmarks.map(item => `BookmarkBegin\nBookmarkTitle: ${item.title}\nBookmarkLevel: ${item.level}\nBookmarkPageNumber: ${item.pageNumber}\n`).join("");
  const files = new Map([["in.pdf", bytes], ["info", new TextEncoder().encode(text)]]);
  expect((await runPdftkCli(["in.pdf", "update_info", "info", "output", "out.pdf"], files)).exitCode).toBe(0);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", bytes);
  const source = await PdfFileSource.open(fs, "/in.pdf"), storage = { fs, directory: "/scratch" }, document = await PdfRetainedDocument.open(source, storage);
  try {
    const edited = await editRetainedDocument(document, storage, { bookmarks });
    try {
      const chunks = []; for await (const chunk of saveRetainedDocumentChunks(edited.document, storage)) chunks.push(chunk);
      const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0)); let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
      expect(output).toEqual(files.get("out.pdf"));
    } finally { await edited.close(); }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

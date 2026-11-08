import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { cosArray, cosDict, cosName, cosString, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";

async function fixture(count = 3) {
  const original = PdfDocument.create(); const page = original.addPage();
  const specs = Array.from({ length: count }, (_, i) => original.cos.allocateObject(cosDict({
    F: cosString(`file-${i}`), EF: cosDict({ Unix: original.cos.allocateObject(cosStream(new TextEncoder().encode(`payload-${i}`), { compress: true })) }),
  })));
  const tree = original.cos.allocateObject(cosDict({ Names: cosArray([cosString("first"), specs[0]!]) }));
  dictSet(original.cos.resolveDict(tree)!, "Kids", cosArray([tree]));
  dictSet(original.cos.resolveDict(original.cos.rootRef)!, "Names", cosDict({ EmbeddedFiles: tree }));
  dictSet(original.cos.resolveDict(original.cos.rootRef)!, "AF", cosArray(specs));
  dictSet(page.pageDict, "AF", cosArray([specs[0]!]));
  dictSet(page.pageDict, "Annots", cosArray([cosDict({ Subtype: cosName("FileAttachment"), FS: specs[1]! })]));
  const bytes = original.save(); const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const source = await PdfFileSource.open({ capabilities: { retainedRead: true }, openReadFile: async () => ({
    stat: async () => ({ type: "file", size: bytes.length }), close: async () => {}, read: async (at: number, count: number) => bytes.slice(at, at + count),
  }) } as unknown as FileSystem, "/input", { chunkBytes: 64, cacheBytes: 128 });
  const document = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { chunkBytes: 64, cacheBytes: 128 });
  return { document, fs, source, async close() { await document.close(); expect(await fs.readdir("/scratch")).toEqual([]); await source.close(); } };
}

describe("retained attachment discovery", () => {
  it("preserves name-tree, associated-file and annotation order without decoding payloads", async () => {
    const f = await fixture(); const decode = vi.spyOn(f.document.objects, "decodeStream");
    const names = [];
    for await (const attachment of f.document.attachments()) names.push(attachment.name);
    expect(names).toEqual(["file-0", "file-1", "file-2"]); expect(decode).not.toHaveBeenCalled(); await f.close();
  });

  it("streams only selected attachment payloads in bounded chunks", async () => {
    const f = await fixture(); const iterator = f.document.attachments();
    const attachment = (await iterator.next()).value!;
    const bytes = []; for await (const chunk of attachment.contents()) { expect(chunk.length).toBeLessThanOrEqual(64); bytes.push(...chunk); }
    expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe("payload-0");
    await iterator.return(); await f.close();
  });

  it("cleans suspended attachment indexes when the document closes", async () => {
    const f = await fixture(80); const iterator = f.document.attachments();
    for (let i = 0; i < 50; i++) await iterator.next();
    await f.close(); expect((await iterator.next()).done).toBe(true);
  });
});

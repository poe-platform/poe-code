import { PdfDocument } from "./document.js";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosString, type PdfCosNode } from "./ast.js";
import { serializeCosDocument } from "./cos/writer.js";
import { PdfFileSource } from "./source.js";
import { PdfRetainedDocument } from "./retained-document.js";

for (const [label, selected, expected] of [
  ["empty", cosString(""), ""], ["name", cosName("Named title"), "Named title"], ["long", cosString("café😀".repeat(8192)), "café😀".repeat(8192)],
  ["invalid", cosNumber(3), undefined], ["indirect", cosRef(4), "Indirect title"]
] as const) it(`streams a selected ${label} metadata field with caller backing`, async () => {
  const bytes = serializeCosDocument({ rootRef: cosRef(1), infoRef: cosRef(3), objects: [
    { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) },
    { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) }) },
    { objectNumber: 3, generationNumber: 0, value: { kind: "dict", entries: [
      { key: cosName("Title"), value: cosString("obsolete") },
      { key: cosName("Unused"), value: cosArray([cosString("unused".repeat(16384)), cosDict({ Nested: cosString("ignored") })]) },
      { key: cosName("Title"), value: selected as PdfCosNode }
    ] } },
    { objectNumber: 4, generationNumber: 0, value: cosString("Indirect title") }
  ] });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", bytes);
  const source = await PdfFileSource.open(fs, "/input", { chunkBytes: 4096, cacheBytes: 4096 });
  const doc = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" });
  try {
    let actual: string | undefined;
    for await (const part of doc.streamInfoValue("Title")) { expect(part.length).toBeLessThanOrEqual(4096); actual = (actual ?? "") + part; }
    expect(actual).toBe(expected);
    let missing = false; for await (const ignored of doc.streamInfoValue("Absent")) { void ignored; missing = true; }
    expect(missing).toBe(false);
    const value = doc.streamInfoValue("Title"); await value.next(); await value.return();
  } finally { await doc.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("streams encrypted metadata and releases suspended field readers on document close", async () => {
  const original = PdfDocument.create(); original.addPage(); const title = "Encrypted café😀".repeat(1024); original.setMetadata({ title });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  await fs.writeFile("/input", original.save({ encrypt: { userPassword: "reader", ownerPassword: "owner" } }));
  const source = await PdfFileSource.open(fs, "/input"), doc = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { password: "reader" });
  try {
    let text = ""; for await (const part of doc.streamInfoValue("Title")) text += part; expect(text).toBe(title);
    const field = doc.streamInfoValue("Title"); await field.next(); await doc.close(); expect((await field.next()).done).toBe(true);
    expect(await fs.readdir("/scratch")).toEqual([]);
  } finally { await doc.close(); await source.close(); }
});
it("cleans selected metadata backing after storage admission fails", async () => {
  const original = PdfDocument.create(); original.addPage(); original.setMetadata({ title: "A".repeat(131072) });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input"), doc = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { maxTraversalStagingBytes: 16384 });
  try { await expect((async () => { for await (const ignored of doc.streamInfoValue("Title")) void ignored; })()).rejects.toMatchObject({ code: "E_LIMIT" }); }
  finally { await doc.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

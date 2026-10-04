import { describe, it, expect } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfMutableObjectStore } from "./mutable-object-store.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfDocument } from "../document.js";
import { cosArray, cosDict, cosName, cosNumber, cosRef, dictGet } from "../ast.js";
import { copyRetainedPagesChunks } from "../edit/retained-page-copy.js";

describe("stored retained document", () => {
  it("keeps indirect stream lengths when copying an unsaved graph", async () => {
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" };
    const store = new PdfMutableObjectStore(storage), payload = new TextEncoder().encode("q Q");
    await store.set({ objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) });
    await store.set({ objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Count: cosNumber(1), Kids: cosArray([cosRef(3)]) }) });
    await store.set({ objectNumber: 3, generationNumber: 0, value: cosDict({ Type: cosName("Page"), Parent: cosRef(2), MediaBox: cosArray([0,0,100,200].map(value => cosNumber(value))), Contents: cosRef(4) }) });
    await store.set({ objectNumber: 4, generationNumber: 0, value: cosDict({ Length: cosRef(5) }), stream: { length: payload.length, chunks: [payload] } });
    await store.set({ objectNumber: 5, generationNumber: 0, value: cosNumber(payload.length) });
    const document = await PdfRetainedDocument.openStore(store, storage, { rootRef: cosRef(1) });
    try {
      const object = await document.objects.get(4); expect(dictGet(object!.value as ReturnType<typeof cosDict>, "Length")).toMatchObject({ kind: "ref", objectNumber: 5, generationNumber: 0 });
      const decoded = []; for await (const bytes of document.objects.decodeStream(4)) decoded.push(bytes);
      expect(new Uint8Array(Buffer.concat(decoded))).toEqual(payload);
      const chunks = []; for await (const bytes of copyRetainedPagesChunks(document, [0], storage)) chunks.push(bytes);
      const copied = PdfDocument.load(new Uint8Array(Buffer.concat(chunks)));
      expect(copied.getPageCount()).toBe(1);
      // The length reference is cloned as an object even though final output
      // normalizes the stream's /Length. Serializing before copying loses it.
      expect([...copied.cos.objects.values()].some(object => object.value.kind === "number" && object.value.value === payload.length)).toBe(true);
    } finally { await document.close(); await store.close(); }
    expect(await fs.readdir("/scratch")).toEqual([]);
  });
});

it("indexes stored identities without parsing their structural values", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }, store = new PdfMutableObjectStore(storage, { maxNodes: 1 });
  await store.set({ objectNumber: 1, generationNumber: 0, value: cosDict({ Values: cosArray(Array.from({ length: 100 }, (_, i) => cosNumber(i))) }) });
  let document: PdfRetainedDocument | undefined;
  try { document = await PdfRetainedDocument.openStore(store, storage, { rootRef: cosRef(1) }); expect((await document.crossReference.index.get(1))?.objectNumber).toBe(1); }
  finally { await document?.close(); await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("decodes indirect filters, validates generations and retains caller ownership", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }, store = new PdfMutableObjectStore(storage);
  await store.set({ objectNumber: 1, generationNumber: 0, value: cosDict({}) });
  await store.set({ objectNumber: 2, generationNumber: 4, value: cosDict({ Filter: cosRef(3) }), stream: { length: 7, chunks: [new TextEncoder().encode("616263>")] } });
  await store.set({ objectNumber: 3, generationNumber: 0, value: cosName("ASCIIHexDecode") });
  const document = await PdfRetainedDocument.openStore(store, storage, { rootRef: cosRef(1) });
  try {
    expect(await document.objects.get(0)).toBeUndefined(); expect(await document.objects.get(2, 0)).toBeUndefined();
    const chunks = []; for await (const bytes of document.objects.decodeStream(2, 4)) chunks.push(bytes);
    expect(Buffer.concat(chunks).toString()).toBe("abc");
    await store.set({ objectNumber: 3, generationNumber: 0, value: cosRef(3) });
    await expect(document.objects.decodeStream(2, 4).next()).rejects.toThrow("cycle");
  } finally { await document.close(); }
  expect((await store.get(1))?.value.kind).toBe("dict");
  await store.close(); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("retains logical page identities when edits clear an aliased page tree", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }, store = new PdfMutableObjectStore(storage);
  await store.set({ objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog") }) });
  await store.set({ objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Page"), MediaBox: cosArray([0,0,100,200].map(value => cosNumber(value))) }) });
  const document = await PdfRetainedDocument.openStore(store, storage, { rootRef: cosRef(1), pageReferences: async function* () { yield cosRef(2); } });
  try { const pages = []; for await (const page of document.pages()) pages.push(page); expect(pages).toHaveLength(1); expect(pages[0]!.reference?.objectNumber).toBe(2); }
  finally { await document.close(); await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

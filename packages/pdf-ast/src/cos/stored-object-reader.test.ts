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

it("keeps lookup path context local while preserving default backing across reference chains", async () => {
  const { PdfFileSource } = await import("../source.js");
  const original = PdfDocument.create(); original.addPage();
  const target = original.cos.allocateObject(cosDict({ D: cosArray([cosArray([cosNumber(2),cosNumber(3)]),cosNumber(0)]), Widths: cosArray([cosNumber(500)]) }));
  const alias = original.cos.allocateObject(target);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input",original.save());
  const source = await PdfFileSource.open(fs,"/input");
  const bytes = new Uint8Array(65536); let end = 0;
  const backing = { allocate(n:number) { const at=end; end+=n; return at; }, async read(at:number,n:number) { return bytes.subarray(at,at+n); }, async write(at:number,part:Uint8Array) { bytes.set(part,at); } };
  const options = { arrayStorage:backing, storedArrayKeys:["Widths"], storedArrayPaths:[["ExtGState","*","D"]] };
  const document = await PdfRetainedDocument.open(source,{fs,directory:"/scratch"},{valueArrays:options});
  try {
    for (const prefix of [undefined,["ExtGState","GS"],undefined]) {
      const result = await document.lookup(alias,undefined,prefix);
      if(result?.value.kind!=="dict")throw Error("Expected dictionary");
      const dash=dictGet(result.value,"D"),widths=dictGet(result.value,"Widths");
      expect(widths).toMatchObject({kind:"array",items:[],storedItems:{length:1,storage:backing}});
      if(dash?.kind!=="array")throw Error("Expected dash");
      expect(dash.items.length).toBe(prefix?0:2);
      expect(dash.storedItems?.length).toBe(prefix?2:undefined);
      expect(result.reference).toMatchObject(target);
    }
    expect(options).not.toHaveProperty("arrayPathPrefix");
  } finally { await document.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]); }
});

it.each(["explicit", "default"])("honors %s caller-backed values when reading edited objects", async mode => {
  const { PagedStorage } = await import("@poe-code/safe-fs/storage");
  const { cosString, decodeStoredPdfString } = await import("../ast.js");
  const { readPdfDictionaryValue } = await import("../content/stored-dictionary.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }, store = new PdfMutableObjectStore(storage);
  const signal = new AbortController().signal, backing = new PagedStorage({ fs, cwd: "/scratch", env: {}, signal }, 2);
  const values = { dictionaryStorage: backing, arrayStorage: backing, stringStorage: backing, containerStorage: backing, deferDictionaryValues: true, storeRootDictionary: true, storeRootString: true };
  const title = "large😀".repeat(8192), reference = await store.allocate(cosDict({ Title: cosString(title) }));
  const document = await PdfRetainedDocument.openStore(store, storage, { rootRef: reference, ...(mode === "default" ? { valueArrays: values } : {}) });
  try {
    const object = await document.objects.get(reference.objectNumber, 0, mode === "explicit" ? values : undefined);
    expect(object?.value.kind).toBe("dict"); if (object?.value.kind !== "dict") throw new Error("missing dictionary");
    expect(object.value.entries).toEqual([]); expect(object.value.storedEntries?.length).toBe(1);
    const value = await readPdfDictionaryValue(object.value, "Title", signal, { preserveDeferred: true });
    if (value?.kind !== "string" || !value.storedBytes) throw new Error("missing stored title");
    expect(value.bytes.length).toBe(0); let actual = ""; for await (const part of decodeStoredPdfString(value.storedBytes, signal)) actual += part;
    expect(actual).toBe(title);
  } finally { await document.close(); await store.close(); await backing.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

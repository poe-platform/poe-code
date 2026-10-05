import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { editRetainedDocument } from "./retained-graph.js";
import { saveRetainedDocumentChunks } from "./retained-save.js";
import type { RetainedInfoUpdate } from "./retained-info-updates.js";

it.each([256, 512])("stages %i generated metadata edits with bounded writes", async count => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const original = PdfDocument.create(); original.addPage(); await fs.writeFile("/input", original.save());
  let writes = 0, outstanding = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args); return new Proxy(handle, { get(target, prop) {
        if (prop === "write") return async (...args: Parameters<NonNullable<typeof handle.write>>) => {
          expect(outstanding).toBe(0); expect(args[0].buffer.byteLength).toBeLessThanOrEqual(65536); outstanding += args[0].length; writes++;
          try { await Promise.resolve(); return await handle.write!(...args); } finally { outstanding -= args[0].length; }
        };
        const value = Reflect.get(target, prop); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const source = await PdfFileSource.open(guarded, "/input"), storage = { fs: guarded, directory: "/scratch" }, document = await PdfRetainedDocument.open(source, storage);
  async function* updates(): AsyncGenerator<RetainedInfoUpdate> {
    const bytes = new Uint8Array(2);
    for (let index = 0; index < count; index++) {
      bytes.fill(index % 256); yield { kind: "id", index: 0, bytes };
      yield { kind: "info", key: "Title", value: `Title ${index}` };
      yield { kind: "page", pageNumber: 1, property: "dimensions", values: [index + 1, index + 2] };
      yield { kind: "label", index, start: 1, prefix: `${index}`, style: "D" };
      yield { kind: "bookmark", title: `Title ${index}`, level: 1, pageNumber: 1 };
    }
    bytes.fill(0);
  }
  try {
    const edited = await editRetainedDocument(document, storage, { infoUpdates: updates() });
    try {
      const page = await edited.getPage(0); expect((await page.attributes()).mediaBox).toEqual([0, 0, count, count + 1]);
      expect(edited.document.crossReference.idArray?.items[0]).toMatchObject({ kind: "string", bytes: Uint8Array.of(255, 255) });
      let outputBytes = 0; for await (const bytes of saveRetainedDocumentChunks(edited.document, storage)) { expect(bytes.buffer.byteLength).toBeLessThanOrEqual(65536); outputBytes += bytes.length; await Promise.resolve(); }
      expect(outputBytes).toBeGreaterThan(count * 40); expect(writes).toBeGreaterThan(0); expect(outstanding).toBe(0);
    } finally { await edited.close(); }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["producer", "cancel", "write"])("cleans metadata staging after %s failure", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const original = PdfDocument.create(); original.addPage(); await fs.writeFile("/input", original.save());
  const reason = new Error("metadata failed"), controller = new AbortController(); let failWrites = false, finalized = false;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args); return new Proxy(handle, { get(target, prop) {
        if (prop === "write") return async (...args: Parameters<NonNullable<typeof handle.write>>) => { if (failWrites) throw reason; return handle.write!(...args); };
        const value = Reflect.get(target, prop); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const source = await PdfFileSource.open(guarded, "/input"), storage = { fs: guarded, directory: "/scratch" }, document = await PdfRetainedDocument.open(source, storage);
  const baseline = await fs.readdir("/scratch");
  async function* updates(): AsyncGenerator<RetainedInfoUpdate> {
    try {
      yield { kind: "label", index: 0, start: 1 };
      if (mode === "producer") throw reason;
      if (mode === "cancel") controller.abort(reason);
      if (mode === "write") failWrites = true;
      for (let index = 0; index < 512; index++) yield { kind: "bookmark", title: `Title ${index}`, level: 1, pageNumber: 1 };
    } finally { finalized = true; }
  }
  try {
    await expect(editRetainedDocument(document, storage, { infoUpdates: updates(), signal: controller.signal })).rejects.toBe(reason);
    expect(finalized).toBe(true); expect(await fs.readdir("/scratch")).toEqual(baseline);
  } finally { failWrites = false; await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("serializes streamed page label prefixes with buffered byte parity", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const original = PdfDocument.create(); original.addPage(); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input"), storage = { fs, directory: "/scratch" }, document = await PdfRetainedDocument.open(source, storage);
  async function* prefix() { for (let i = 0; i < 64; i++) yield "prefix(\\)".repeat(256); yield "😀"; }
  let buffered = ""; for await (const part of prefix()) buffered += part;
  const outputs: string[] = [];
  try {
    for (const value of [buffered, prefix]) {
      const edited = await editRetainedDocument(document, storage, { infoUpdates: [{ kind: "label", index: 0, start: 2, style: "D", prefix: value }] });
      try { let output = ""; for await (const bytes of saveRetainedDocumentChunks(edited.document, storage)) { expect(bytes.length).toBeLessThanOrEqual(65536); output += new TextDecoder("latin1").decode(bytes); } outputs.push(output); }
      finally { await edited.close(); }
    }
    expect(outputs[1]).toBe(outputs[0]);
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("updates streamed info values while retaining existing metadata", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const original = PdfDocument.create(); original.addPage(); original.setTitle("before"); original.setAuthor("Å".repeat(32768)); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input"), storage = { fs, directory: "/scratch" }, document = await PdfRetainedDocument.open(source, storage);
  async function* title() { for (let i = 0; i < 32; i++) yield "value(\\)".repeat(256); yield "😀"; }
  let expected = ""; for await (const part of title()) expected += part;
  try {
    const edited = await editRetainedDocument(document, storage, { infoUpdates: [{ kind: "info", key: "Title", value: title }, { kind: "info", key: "Subject", value: "last" }] });
    try {
      for (const [key, expectedValue] of [["Title", expected], ["Author", "Å".repeat(32768)], ["Subject", "last"]]) {
        let actual = ""; for await (const text of edited.document.streamInfoValue(key!)) actual += text; expect(actual).toBe(expectedValue);
      }
    } finally { await edited.close(); }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("cleans caller backing when a streamed metadata value fails", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const original = PdfDocument.create(); original.addPage(); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input"), storage = { fs, directory: "/scratch" }, document = await PdfRetainedDocument.open(source, storage), reason = new Error("metadata producer failed");
  const baseline = await fs.readdir("/scratch"); let closed = false;
  async function* value() { try { yield "value"; throw reason; } finally { closed = true; } }
  try {
    await expect(editRetainedDocument(document, storage, { infoUpdates: [{ kind: "info", key: "Title", value }] })).rejects.toBe(reason);
    expect(closed).toBe(true); expect(await fs.readdir("/scratch")).toEqual(baseline);
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("replaces only the last duplicate metadata key without rewriting other values", async () => {
  const { cosArray, cosName, cosString, dictSet } = await import("../ast.js");
  const { serializeCosNodeBytes } = await import("../cos/writer.js");
  const { serializeRetainedCosNodeChunks } = await import("../cos/retained-node-writer.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const original = PdfDocument.create(); original.addPage(); original.setTitle("first");
  const info = original.cos.resolveDict(original.cos.infoRef!)!;
  info.entries.push({ key: cosName("Title"), value: cosString("second") });
  dictSet(info, "Custom", cosArray([cosString("😀"), cosString("literal")]));
  await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input"), storage = { fs, directory: "/scratch" }, document = await PdfRetainedDocument.open(source, storage);
  try {
    // The initial mutable copy uses the parsed COS representation. Compare
    // against that established byte representation, including nested strings.
    const parsed = (await document.lookup(document.crossReference.infoRef))!.value;
    if (parsed.kind !== "dict") throw new Error("expected info dictionary");
    const expected = { ...parsed, entries: [...parsed.entries] };
    dictSet(expected, "Title", cosString("replacement"));
    const edited = await editRetainedDocument(document, storage, { infoUpdates: [{ kind: "info", key: "Title", value: async function* () { yield "replacement"; } }] });
    try {
      const actual = (await edited.document.lookup(edited.document.crossReference.infoRef))!.value, parts = [];
      for await (const part of serializeRetainedCosNodeChunks(actual, { preserveStringEncoding: true })) parts.push(part);
      expect(Buffer.concat(parts)).toEqual(Buffer.from(serializeCosNodeBytes(expected)));
    } finally { await edited.close(); }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("applies repeated streamed metadata keys without collecting generated names", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const original = PdfDocument.create(); original.addPage(); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input"), storage = { fs, directory: "/scratch" }, document = await PdfRetainedDocument.open(source, storage);
  async function* key() { for (let i = 0; i < 16; i++) yield "custom".repeat(16); }
  const name = "custom".repeat(256);
  try {
    const edited = await editRetainedDocument(document, storage, { infoUpdates: [{ kind: "info", key, value: "first" }, { kind: "info", key, value: "last" }, { kind: "info", key: async function* () { yield "Title"; }, value: "title" }] });
    try {
      let value = ""; for await (const part of edited.document.streamInfoValue(name)) value += part; expect(value).toBe("last");
      let title = ""; for await (const part of edited.document.streamInfoValue("Title")) title += part; expect(title).toBe("title");
    } finally { await edited.close(); }
  } finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

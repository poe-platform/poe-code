import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { cosArray, cosBool, cosDict, cosName, cosString, dictSet } from "../ast.js";
import { walkRetainedFormFields } from "./retained-form-fields.js";

it("streams field summaries with buffered naming, inheritance and duplicate semantics", async () => {
  const original = PdfDocument.create(); original.addPage();
  const parent = original.cos.allocateObject(cosDict({ T: cosString("group"), FT: cosName("Tx"), V: cosString("inherited") }));
  const text = original.cos.allocateObject(cosDict({ T: cosString("text"), Parent: parent }));
  const check = original.cos.allocateObject(cosDict({ T: cosString("check"), FT: cosName("Btn"), V: cosBool(true) }));
  const choice = original.cos.allocateObject(cosDict({ T: cosString("choice"), FT: cosName("Ch"), V: cosArray([cosString("first"), cosName("second")]) }));
  dictSet(original.cos.resolveDict(parent)!, "Kids", cosArray([text, check, choice]));
  const widget = original.cos.allocateObject(cosDict({ T: cosString("widget"), FT: cosName("Tx"), V: cosString("value"), Kids: cosArray([cosDict({ Subtype: cosName("Widget") })]) }));
  dictSet(original.cos.resolveDict(original.cos.rootRef)!, "AcroForm", original.cos.allocateObject(cosDict({ Fields: cosArray([parent, widget, parent]) })));
  const input = original.save(), expected = PdfDocument.load(input).getFormFields().map(({ name, type, value }) => ({ name, type, value }));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", input); const storage = { fs, directory: "/scratch" };
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, storage);
  try { const actual = []; for await (const field of document.formFields()) actual.push(field); expect(actual).toEqual(expected); }
  finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([1024, 4096])("streams %i generated fields with bounded backing and slow consumption", async count => {
  const { cosRef } = await import("../ast.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let outstanding = 0, peak = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole field I/O forbidden"); };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args);
      return new Proxy(handle, { get(owner, key) {
        if (key === "write") return async (bytes: Uint8Array, ...args: unknown[]) => {
          expect(outstanding).toBe(0); outstanding += bytes.length; peak = Math.max(peak, bytes.buffer.byteLength); expect(peak).toBeLessThanOrEqual(16384);
          try { await Promise.resolve(); return await Reflect.apply(handle.write!, handle, [bytes, ...args]); } finally { outstanding -= bytes.length; }
        };
        const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const document = { depthLimit: Infinity, crossReference: { rootRef: cosRef(1) }, async lookup(node: import("../ast.js").PdfCosNode | undefined) {
    if (node?.kind !== "ref") return node ? { value: node } : undefined;
    const treeIndex = node.objectNumber - 3;
    return { value: node.objectNumber === 1 ? cosDict({ AcroForm: cosRef(2) }) : node.objectNumber === 2 ? cosDict({ Fields: cosArray([cosRef(3)]) }) : treeIndex < count - 1 ? cosDict({ FT: cosName("Tx"), Kids: cosArray([cosRef(treeIndex * 2 + 4), cosRef(treeIndex * 2 + 5)]) }) : cosDict({ T: cosString(`field${treeIndex - count + 1}`), V: cosString("value") }) };
  } } as unknown as PdfRetainedDocument;
  let seen = 0;
  for await (const field of walkRetainedFormFields(document, { fs: guarded, directory: "/scratch" })) { expect(field).toEqual({ name: `field${seen++}`, type: "text", value: "value" }); await Promise.resolve(); }
  expect(seen).toBe(count); expect(peak).toBeGreaterThan(0); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["cycle", "cancel", "limit", "return"])("releases field traversal state after %s", async mode => {
  const { cosRef } = await import("../ast.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }, controller = new AbortController(), reason = new Error("cancel fields");
  const document = { depthLimit: Infinity, crossReference: { rootRef: cosRef(1) }, async lookup(node: import("../ast.js").PdfCosNode | undefined) {
    if (node?.kind !== "ref") return node ? { value: node } : undefined;
    if (node.objectNumber === 1) return { value: cosDict({ AcroForm: cosDict({ Fields: cosArray([cosRef(2), cosRef(3)]) }) }) };
    return { value: cosDict({ T: cosString("field"), FT: cosName("Tx"), ...(node.objectNumber === 2 && mode === "cycle" ? { Kids: cosArray([cosRef(2)]) } : {}) }) };
  } } as unknown as PdfRetainedDocument;
  if (mode === "cancel") controller.abort(reason);
  const output = walkRetainedFormFields(document, storage, { signal: controller.signal, ...(mode === "limit" ? { maxStagingBytes: 1 } : {}) });
  if (mode === "cancel" || mode === "limit") await expect((async () => { for await (const ignored of output) void ignored; })()).rejects.toThrow(mode === "cancel" ? "cancel fields" : "limit");
  else if (mode === "return") { expect((await output.next()).done).toBe(false); await output.return(undefined); }
  else { const fields = []; for await (const field of output) fields.push(field); expect(fields).toHaveLength(1); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("closes a suspended field iterator with its document", async () => {
  const original = PdfDocument.create(); original.addPage();
  dictSet(original.cos.resolveDict(original.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([cosDict({ T: cosString("field"), FT: cosName("Tx") })]) }));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input"), document = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" });
  const fields = document.formFields(); expect((await fields.next()).value).toMatchObject({ name: "field" });
  await document.close(); expect((await fields.next()).done).toBe(true); await source.close();
  expect(await fs.readdir("/scratch")).toEqual([]);
});

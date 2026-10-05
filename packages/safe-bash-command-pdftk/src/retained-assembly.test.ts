import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, PdfFileSource, PdfRetainedDocument, cosStream, cosArray, cosDict, cosName, cosString, cosNumber, cosHexString, dictGet, dictSet, dictDelete } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand, runPdftkCli } from "./index.js";

it.each(["cat", "shuffle"].flatMap(operation => [[], ["A1-end", "Bend-1"], ["B2east", "A1right", "A1"], ["A1-endeven", "B1-endodd"], ["A99"]].map(ranges => ({ operation, ranges }))))("streams $operation $ranges with exact bytes", async ({ operation, ranges }) => {
  const a = PdfDocument.create(), b = PdfDocument.create(); a.setTitle("Primary"); b.setTitle("Secondary");
  for (let i = 0; i < 3; i++) a.addPage().drawText(`A${i}`, { x: 20, y: 30 });
  for (let i = 0; i < 2; i++) b.addPage().drawText(`B${i}`, { x: 20, y: 30 });
  const first = a.save(), second = b.save(), args = ["A=a.pdf", "B=b.pdf", operation, ...ranges, "output", "out.pdf"];
  const files = new Map([["a.pdf", first], ["b.pdf", second]]), expected = await runPdftkCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/a.pdf", first); await fs.writeFile("/b.pdf", second);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args); let stderr = "";
  const result = await createPdftkCommand({ limits: { maxInputBytes: first.length + second.length } }).execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode, stderr).toBe(expected.exitCode); expect(stderr).toBe(expected.stderr); expect(await fs.readFile("/out.pdf")).toEqual(files.get("out.pdf")); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["cat", "shuffle"].flatMap(operation => ["bookmarks", "name-title", "attachments", "sentinel", "forms", "inherited", "empty", "duplicate-handle", "encrypted", "stdin", "ids"].map(mode => ({ operation, mode }))))("preserves $operation $mode semantics", async ({ operation, mode }) => {
  const a = PdfDocument.create(), b = PdfDocument.create(); a.setTitle("Primary"); b.setTitle("Secondary");
  for (const doc of [a, b]) {
    if (mode !== "empty") for (let i = 0; i < (doc === a ? 3 : 2); i++) doc.addPage().drawText(`Page ${i}`, { x: 20, y: 30 });
    if (mode === "inherited") {
      const pages = doc.cos.resolveDict(dictGet(doc.cos.resolveDict(doc.cos.rootRef)!, "Pages"))!;
      dictSet(pages, "Resources", doc.getPage(0).getResourcesDict());
      for (const page of doc.getPages()) dictDelete(page.pageDict, "Resources");
    }
    if (mode === "forms") {
      const field = doc.cos.allocateObject(cosDict({ FT: cosName("Tx"), T: cosString("field"), V: cosString(doc === a ? "A" : "B"), Subtype: cosName("Widget"), P: doc.getPage(0).ref, Rect: cosArray([0, 0, 30, 20].map(n => cosNumber(n))) }));
      dictSet(doc.getPage(0).pageDict, "Annots", cosArray([field]));
      dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([field]) }));
    }
    if (mode === "ids") doc.cos.idArray = cosArray([cosHexString(Uint8Array.of(doc === a ? 1 : 2)), cosHexString(Uint8Array.of(3))]);
  }
  let first = a.save(mode === "encrypted" ? { encrypt: { userPassword: "secret", ownerPassword: "owner" } } : {}), second = b.save();
  for (const source of ["first", "second"]) {
    const bytes = source === "first" ? first : second;
    const files = new Map([["input", bytes], ["info", new TextEncoder().encode("BookmarkBegin\nBookmarkTitle: Root\nBookmarkLevel: 1\nBookmarkPageNumber: 1\nBookmarkBegin\nBookmarkTitle: Child\nBookmarkLevel: 2\nBookmarkPageNumber: 2\n")], [mode === "sentinel" ? "-" : "payload.bin", Uint8Array.of(source === "first" ? 1 : 2, 0, 255)]]);
    if (mode === "bookmarks" || mode === "name-title") await runPdftkCli(["input", "update_info", "info", "output", "out"], files);
    else if (mode === "attachments" || mode === "sentinel") await runPdftkCli(["input", "attach_files", mode === "sentinel" ? "-" : "payload.bin", "output", "out"], files);
    if (mode === "name-title") {
      const doc = PdfDocument.load(files.get("out")!); const catalog = doc.cos.resolveDict(doc.cos.rootRef)!, outlines = doc.cos.resolveDict(dictGet(catalog, "Outlines"))!, first = doc.cos.resolveDict(dictGet(outlines, "First"))!;
      dictSet(first, "Title", cosName("Named title")); files.set("out", doc.save());
    }
    if (files.has("out")) { if (source === "first") first = files.get("out")!; else second = files.get("out")!; }
  }
  const args = [mode === "stdin" ? "A=-" : "A=a.pdf", mode === "duplicate-handle" ? "A=b.pdf" : "B=b.pdf", ...(mode === "encrypted" ? ["input_pw", "A=secret"] : []), operation, ...(mode === "duplicate-handle" || mode === "empty" ? [] : ["B1-end", "A1-end", "A1"]), "output", "out.pdf", ...(mode === "ids" ? ["keep_final_id"] : [])];
  const files = new Map([["a.pdf", first], ["b.pdf", second], ["-", first]]);
  let expected: Awaited<ReturnType<typeof runPdftkCli>> | undefined, expectedError: unknown;
  try { expected = await runPdftkCli(args, files); } catch (error) { expectedError = error; }
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/a.pdf", first); await fs.writeFile("/b.pdf", second);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args); let stderr = "";
  const execution = createPdftkCommand({ limits: { maxInputBytes: first.length + second.length } }).execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal, stdin: (async function* () { const buffer = new Uint8Array(31); for (let offset = 0; offset < first.length; offset += buffer.length) { const length = Math.min(buffer.length, first.length - offset); buffer.set(first.subarray(offset, offset + length)); yield buffer.subarray(0, length); } })(), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  if (expectedError) await expect(execution).rejects.toMatchObject({ message: (expectedError as Error).message });
  else { const result = await execution; expect(result.exitCode, stderr).toBe(expected!.exitCode); expect(stderr).toBe(expected!.stderr); expect(await fs.readFile("/out.pdf")).toEqual(files.get("out.pdf")); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["write", "cancel", "backing"])("cleans assembly backing and preserves output after %s failure", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const doc = PdfDocument.create(); const page = doc.addPage();
  dictSet(page.pageDict, "Contents", doc.cos.allocateObject(cosStream(new TextEncoder().encode("% generated content\n".repeat(8192)), { compress: false })));
  await fs.writeFile("/in.pdf", doc.save()); await fs.writeFile("/out.pdf", Uint8Array.of(7));
  const reason = new Error("assembly failed"), controller = new AbortController(); let writes = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "open" && mode === "backing") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args); return new Proxy(handle, { get(target, property) {
        if (property === "write") return async (...args: Parameters<NonNullable<typeof handle.write>>) => { if (++writes > 1) throw reason; return handle.write!(...args); };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    if (key === "createStagedFile" && mode !== "backing") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const file = await fs.createStagedFile!(...args); return { ...file, writer: { ...file.writer!, write: async () => { if (mode === "cancel") controller.abort(reason); throw reason; } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const args = createCommandArguments(["in.pdf", "cat", "1", "1right", "output", "out.pdf"]);
  await expect(createPdftkCommand().execute({ command: "pdftk", args: args.args, argumentValues: args, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })).rejects.toBe(reason);
  expect(await fs.readFile("/out.pdf")).toEqual(Uint8Array.of(7)); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([16, 32])("copies %i repeated payloads with bounded backing and slow output writes", async count => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const doc = PdfDocument.create(), page = doc.addPage();
  dictSet(page.pageDict, "Contents", doc.cos.allocateObject(cosStream(new TextEncoder().encode("% generated content\n".repeat(8192)), { compress: false })));
  const input = doc.save(); await fs.writeFile("/in.pdf", input);
  let backingWrites = 0, sinkWrites = 0, outstanding = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args); return new Proxy(handle, { get(target, property) {
        if (property === "write") return async (...args: Parameters<NonNullable<typeof handle.write>>) => { expect(args[0].buffer.byteLength).toBeLessThanOrEqual(65536); backingWrites++; return handle.write!(...args); };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const file = await fs.createStagedFile!(...args), writer = file.writer!;
      return { ...file, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        expect(outstanding).toBe(0); expect(bytes.buffer.byteLength).toBeLessThanOrEqual(65536); outstanding += bytes.length; sinkWrites++;
        try { await Promise.resolve(); return await writer.write(bytes, options); } finally { outstanding -= bytes.length; }
      } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const args = createCommandArguments(["in.pdf", "cat", ...Array.from({ length: count }, () => "1"), "output", "out.pdf"]);
  const result = await createPdftkCommand({ limits: { maxInputBytes: input.length } }).execute({ command: "pdftk", args: args.args, argumentValues: args, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(0); expect(backingWrites).toBeGreaterThan(count); expect(sinkWrites).toBeGreaterThan(count); expect(outstanding).toBe(0); expect(await fs.readdir("/scratch")).toEqual([]);
  const source = await PdfFileSource.open(fs, "/out.pdf"), document = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" });
  try { let pages = 0; for await (const ignored of document.pages()) { void ignored; pages++; } expect(pages).toBe(count); }
  finally { await document.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

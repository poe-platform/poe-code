import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosDict, cosName, cosString, cosArray, cosNumber, cosStream, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand, runPdftkCli } from "./index.js";

it.each([[], ["output", "part_%03d.pdf"], ["output", "part_%%_%d_%d.pdf"], ["output", "same.pdf"], ["output", "-"], ["compress"], ["uncompress"], ["drop_xmp", "need_appearances", "user_pw", "ignored"]].map(flags => ({ flags })))("bursts retained pages with legacy bytes: $flags", async ({ flags }) => {
  const doc = PdfDocument.create(); doc.setTitle("Burst title"); doc.setAuthor("Author");
  for (let i = 0; i < 3; i++) { const page = doc.addPage(); page.drawText(`Page ${i}`, { x: 10, y: 20 }); page.setRotation(i === 1 ? 90 : 0); }
  const input = doc.save(), args = ["in.pdf", "burst", ...flags];
  const files = new Map([["in.pdf", input]]), expected = await runPdftkCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args); let stderr = "";
  const result = await createPdftkCommand().execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() { throw new Error("unexpected stdout"); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode).toBe(expected.exitCode); expect(stderr).toBe(expected.stderr);
  for (const [name, bytes] of files) if (name !== "-") expect(await fs.readFile(`/${name}`), name).toEqual(bytes);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["stdin", "encrypted", "empty", "overwrite", "report", "forms", "nested"])("preserves burst %s behavior", async mode => {
  const doc = PdfDocument.create();
  if (mode !== "empty") for (let i = 0; i < 3; i++) doc.addPage().drawText(`Page ${i}`, { x: 10, y: 20 });
  if (mode === "forms") {
    const field = doc.cos.allocateObject(cosDict({ FT: cosName("Tx"), T: cosString("name"), V: cosString("Value"), Subtype: cosName("Widget"), Rect: cosArray([0, 0, 100, 30].map(value => cosNumber(value))), P: doc.getPage(0).ref }));
    dictSet(doc.getPage(0).pageDict, "Annots", cosArray([field]));
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([field]) }));
  }
  const input = doc.save(mode === "encrypted" ? { encrypt: { userPassword: "secret", ownerPassword: "owner" } } : {});
  const args = [mode === "stdin" ? "-" : "in.pdf", ...(mode === "encrypted" ? ["input_pw", "secret"] : []), "burst", ...(mode === "overwrite" ? ["output", "in.pdf"] : mode === "report" ? ["output", "doc_data.txt"] : mode === "nested" ? ["output", "result/page_%04d.pdf"] : [])];
  const files = new Map([[mode === "stdin" ? "-" : "in.pdf", input]]), expected = await runPdftkCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.mkdir("/result"); await fs.writeFile("/in.pdf", input);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args); let stderr = "";
  const result = await createPdftkCommand({ limits: { maxInputBytes: input.length } }).execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* () { const buffer = new Uint8Array(97); for (let offset = 0; offset < input.length; offset += buffer.length) { const length = Math.min(buffer.length, input.length - offset); buffer.set(input.subarray(offset, offset + length)); yield buffer.subarray(0, length); } })(),
    stdout: { async write() { throw new Error("unexpected stdout"); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode).toBe(expected.exitCode); expect(stderr).toBe(expected.stderr);
  for (const [name, bytes] of files) if (name !== "-") expect(await fs.readFile(`/${name}`), name).toEqual(bytes);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["write", "cancel", "publish"])("cleans burst backing and preserves destination after %s failure", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const doc = PdfDocument.create(); doc.addPage().drawText("page", { x: 10, y: 20 });
  await fs.writeFile("/in.pdf", doc.save()); await fs.writeFile("/pg_0001.pdf", Uint8Array.of(7));
  const reason = new Error("burst failed"), controller = new AbortController();
  const guarded = new Proxy(fs, { get(owner, key) {
    if (mode === "publish" && key === "publishStagedFile") return async () => { throw reason; };
    if (key === "createStagedFile" && mode !== "publish") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const file = await fs.createStagedFile!(...args); return { ...file, writer: { ...file.writer!, write: async () => { if (mode === "cancel") controller.abort(reason); throw reason; } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const args = createCommandArguments(["in.pdf", "burst"]);
  await expect(createPdftkCommand().execute({ command: "pdftk", args: args.args, argumentValues: args, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })).rejects.toBe(reason);
  expect(await fs.readFile("/pg_0001.pdf")).toEqual(Uint8Array.of(7)); expect(await fs.readdir("/scratch")).toEqual([]);
  expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["in.pdf", "pg_0001.pdf", "scratch"]);
});

it.each([4, 8])("streams %i generated pages into a slow sink with bounded writes", async pages => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const doc = PdfDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage();
    dictSet(page.pageDict, "Contents", doc.cos.allocateObject(cosStream(new TextEncoder().encode("% generated content\n".repeat(8192)), { compress: false })));
  }
  const input = doc.save(); await fs.writeFile("/in.pdf", input);
  let outstanding = 0, writes = 0, publications = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const file = await fs.createStagedFile!(...args), writer = file.writer!;
      return { ...file, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        expect(outstanding).toBe(0); expect(bytes.buffer.byteLength).toBeLessThanOrEqual(65536);
        outstanding += bytes.length; writes++;
        try { await Promise.resolve(); return await writer.write(bytes, options); } finally { outstanding -= bytes.length; }
      } } };
    };
    if (key === "publishStagedFile") return async (...args: Parameters<NonNullable<typeof fs.publishStagedFile>>) => { publications++; return fs.publishStagedFile!(...args); };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const args = createCommandArguments(["in.pdf", "burst"]);
  const result = await createPdftkCommand({ limits: { maxInputBytes: input.length } }).execute({ command: "pdftk", args: args.args, argumentValues: args, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(0); expect(publications).toBe(pages + 1); expect(writes).toBeGreaterThan(pages * 4); expect(outstanding).toBe(0);
  for (let i = 1; i <= pages; i++) expect(PdfDocument.load(await fs.readFile(`/pg_${String(i).padStart(4, "0")}.pdf`)).pageCount).toBe(1);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

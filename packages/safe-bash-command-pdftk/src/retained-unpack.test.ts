import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, serializeRetainedCosDocumentChunks, cosRef, cosNumber, cosArray, cosDict, cosName, cosStream, cosString, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand, runPdftkCli } from "./index.js";

for (const mode of ["basic", "associated", "annotation", "fallback", "nested", "cycle", "duplicate", "basename", "input", "input-order", "dash", "empty", "stdin", "encrypted", "large"]) it(`extracts ${mode} attachments with exact compatibility bytes`, async () => {
  const doc = PdfDocument.create(), page = doc.addPage(), root = doc.cos.resolveDict(doc.cos.rootRef)!;
  const payload = new TextEncoder().encode(mode === "large" ? "更新😀".repeat(18000) : "payload");
  function spec(name: string, bytes: Uint8Array) { const stream = doc.cos.allocateObject(cosStream(cosDict({ Type: cosName("EmbeddedFile") }), bytes)); return doc.cos.allocateObject(cosDict({ ...(mode === "fallback" ? {} : { F: cosString(name) }), EF: cosDict({ [mode === "fallback" ? "Unix" : "F"]: stream }) })); }
  const name = mode === "basename" ? "../nested\\payload.txt" : mode === "input" ? "in.pdf" : mode === "dash" ? "-" : "payload.txt", first = spec(name, payload);
  const tree = doc.cos.allocateObject(cosDict({ Names: cosArray([cosString("fallback.bin"), first]) }));
  if (mode === "cycle") dictSet(doc.cos.resolveDict(tree)!, "Kids", cosArray([tree]));
  if (mode === "nested") dictSet(root, "Names", cosDict({ EmbeddedFiles: cosDict({ Kids: cosArray([tree]) }) }));
  else if (mode === "associated") { dictSet(root, "AF", cosArray([first])); dictSet(page.dict, "AF", cosArray([spec("second.bin", new Uint8Array([1, 2, 3]))])); }
  else if (mode === "annotation") dictSet(page.dict, "Annots", cosArray([cosDict({ Subtype: cosName("FileAttachment"), FS: first })]));
  else if (mode !== "empty") dictSet(root, "Names", cosDict({ EmbeddedFiles: tree }));
  if (mode === "input-order") dictSet(root, "AF", cosArray([spec("in.pdf", new Uint8Array([42]))]));
  if (mode === "duplicate") dictSet(page.dict, "AF", cosArray([spec(name, new TextEncoder().encode("last"))]));
  const input = doc.save(mode === "encrypted" ? { encrypt: { userPassword: "secret", ownerPassword: "owner" } } : {});
  const args = [mode === "stdin" ? "-" : "in.pdf", ...(mode === "encrypted" ? ["input_pw", "secret"] : []), "unpack_files"], files = new Map([[mode === "stdin" ? "-" : "in.pdf", input]]);
  const expected = await runPdftkCli(args, files), fs = createMemoryFileSystem(); await fs.mkdir("/work"); await fs.mkdir("/scratch"); await fs.writeFile("/work/in.pdf", input);
  const publications: string[] = [];
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "publishStagedFile") return async (...args: Parameters<NonNullable<typeof fs.publishStagedFile>>) => { publications.push(args[1]); return fs.publishStagedFile!(...args); }; if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file attachment I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args); let stdout = "", stderr = "";
  const result = await createPdftkCommand().execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/work", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* () { if (mode === "stdin") yield input; })(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode).toBe(expected.exitCode); expect(stdout).toBe(expected.stdout); expect(stderr).toBe(expected.stderr);
  for (const [name, bytes] of files) if (name !== "-") expect(await fs.readFile(`/work/${name}`)).toEqual(bytes);
  expect(await fs.readdir("/scratch")).toEqual([]);
  if (mode === "input-order") expect(publications).toEqual(["/work/in.pdf", "/work/payload.txt"]);
});

for (const mode of ["slow", "cancel", "write", "invalid-later", "missing-parent", "input-limit"]) it(`preserves attachment publication and cleanup after ${mode}`, async () => {
  const doc = PdfDocument.create(); doc.addPage();
  const stream = doc.cos.allocateObject(cosStream(cosDict({}), new Uint8Array(150000).fill(7)));
  const spec = doc.cos.allocateObject(cosDict({ F: cosString("payload.bin"), EF: cosDict({ F: stream }) }));
  const bad = doc.cos.allocateObject(cosDict({ F: cosString("../.."), EF: cosDict({ F: stream }) }));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AF", cosArray(mode === "invalid-later" ? [spec, bad] : [spec]));
  const input = doc.save(), fs = createMemoryFileSystem(); await fs.mkdir("/work"); await fs.mkdir("/scratch");
  await fs.writeFile("/work/in.pdf", input); await fs.writeFile("/work/payload.bin", new Uint8Array([99]));
  const controller = new AbortController(), reason = new Error("injected attachment failure");
  let pending = 0, peak = 0, opened = 0, closed = 0, injected = false;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file attachment I/O forbidden"); };
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => { const handle = await fs.openReadFile!(...args); opened++; return { ...handle, async close() { closed++; await handle.close(); } }; };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const stage = await fs.createStagedFile!(...args), writer = stage.writer; if (!writer) return stage;
      return { ...stage, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        pending += bytes.length; peak = Math.max(peak, pending); expect(bytes.buffer.byteLength).toBeLessThanOrEqual(65536);
        try {
          if (!injected && bytes.length >= 4096 && bytes[0] === 7) {
            if (mode === "cancel") { injected = true; controller.abort(reason); }
            if (mode === "write") { injected = true; throw reason; }
          }
          await Promise.resolve(); return await writer.write(bytes, options);
        } finally { pending -= bytes.length; }
      } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(["in.pdf", "unpack_files", ...(mode === "missing-parent" ? ["output", "/missing"] : [])]); let errors = "";
  const execute = () => createPdftkCommand(mode === "input-limit" ? { limits: { maxInputBytes: input.length - 1 } } : {}).execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/work", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } } });
  if (mode === "slow") expect((await execute()).exitCode).toBe(0);
  else if (mode === "missing-parent") { expect((await execute()).exitCode).toBe(1); expect(errors).toContain("/missing/payload.bin"); await expect(fs.stat("/missing")).rejects.toMatchObject({ code: "ENOENT" }); }
  else if (mode === "input-limit") await expect(execute()).rejects.toThrow(/limit/);
  else if (mode === "invalid-later") await expect(execute()).rejects.toThrow("Invalid embedded attachment filename");
  else { await expect(execute()).rejects.toBe(reason); expect(injected).toBe(true); }
  expect(await fs.readFile("/work/payload.bin")).toEqual(mode === "slow" ? new Uint8Array(150000).fill(7) : new Uint8Array([99]));
  expect(await fs.readdir("/scratch")).toEqual([]); expect(opened).toBe(closed); expect(pending).toBe(0); expect(peak).toBeLessThanOrEqual(65536);
});


it("extracts reused generated payload chunks without full-file I/O", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.mkdir("/work");
  const chunk = new Uint8Array(8192).fill(7); let produced = 0, writes = 0, pending = 0, peak = 0;
  async function* objects() {
    yield { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2), AF: cosArray(Array.from({ length: 8 }, (_, i) => cosRef(i + 4))) }) };
    yield { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Kids: cosArray([]), Count: cosNumber(0) }) };
    yield { objectNumber: 3, generationNumber: 0, value: cosDict({ Length: cosNumber(chunk.length * 8) }), stream: { length: chunk.length * 8, chunks: (async function* () { for (let i = 0; i < 8; i++) { produced++; yield chunk; } })() } };
    for (let i = 0; i < 8; i++) yield { objectNumber: i + 4, generationNumber: 0, value: cosDict({ F: cosString(`payload-${i}.bin`), EF: cosDict({ F: cosRef(3) }) }) };
  }
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file attachment I/O forbidden"); };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args);
      return new Proxy(handle, { get(owner, key) {
        if (key === "write") return async (...args: Parameters<typeof handle.write>) => { const size = args[0].byteLength; writes += size; pending += size; peak = Math.max(peak, pending); try { await Promise.resolve(); return await handle.write(...args); } finally { pending -= size; } };
        const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const args = createCommandArguments(["-", "unpack_files"]);
  const result = await createPdftkCommand().execute({ command: "pdftk", args: args.args, argumentValues: args, cwd: "/work", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: serializeRetainedCosDocumentChunks({ rootRef: cosRef(1), objects: objects() }, { fs: guarded, directory: "/scratch" }), stdout: { async write() {} }, stderr: { async write(bytes) { throw new Error(new TextDecoder().decode(bytes)); } } });
  expect(result.exitCode).toBe(0); expect(produced).toBe(8); expect(writes).toBeGreaterThan(65536); expect(peak).toBeLessThanOrEqual(65536); expect(pending).toBe(0);
  for (let i = 0; i < 8; i++) expect(await fs.readFile(`/work/payload-${i}.bin`)).toEqual(new Uint8Array(65536).fill(7));
  expect(await fs.readdir("/scratch")).toEqual([]);
});

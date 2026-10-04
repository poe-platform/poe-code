import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosString, cosBool, cosRef, dictDelete, serializeRetainedCosDocumentChunks, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand, runPdftkCli } from "./index.js";

function text(chunks: Uint8Array[]) { const decoder = new TextDecoder(); return chunks.map(chunk => decoder.decode(chunk, { stream: true })).join("") + decoder.decode(); }

for (const mode of ["basic", "utf8", "file", "stdin", "encrypted", "multiple", "empty", "actions", "cycle", "named", "numeric", "missing", "invalid", "dest", "dictdest", "legacy-name", "name-kids", "wrong-password", "second-invalid", "direct", "array-action", "numeric-outside", "repeat"]) it(`streams ${mode} annotation inspection with legacy output`, async () => {
  const doc = PdfDocument.create(), page = doc.addPage(), second = doc.addPage();
  const action = cosDict({ S: cosName("GoTo"), D: cosArray([second.ref, cosName("Fit")]), URI: cosString("https://example.com/é"), F: cosDict({ UF: cosString("外.pdf") }) });
  const ref = doc.cos.allocateObject(action);
  if (mode === "cycle") dictSet(action, "Next", ref);
  if (mode === "actions") dictSet(action, "Next", cosArray([cosDict({ S: cosName("URI"), URI: cosString("next") }), ref]));
  if (mode === "named") { dictSet(action, "D", cosString("target")); dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", cosDict({ Dests: cosDict({ Names: cosArray([cosString("target"), cosArray([second.ref, cosName("Fit")])]) }) })); }
  if (mode === "numeric") dictSet(action, "D", cosArray([cosNumber(0.5), cosName("Fit")]));
  if (mode === "dictdest") dictSet(action, "D", cosDict({ D: cosArray([second.ref]) }));
  if (mode === "numeric-outside") dictSet(action, "D", cosArray([cosNumber(99)]));
  if (mode === "legacy-name") { dictSet(action, "D", cosName("target")); dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Dests", cosDict({ target: cosDict({ D: cosArray([second.ref]) }) })); }
  if (mode === "name-kids") { dictSet(action, "D", cosString("target")); const branch = cosDict({ Names: cosArray([cosString("target"), cosArray([second.ref])]) }); const child = doc.cos.allocateObject(branch); dictSet(branch, "Kids", cosArray([child])); dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", cosDict({ Dests: cosDict({ Kids: cosArray([child]) }) })); }
  const annotation = cosDict({ Subtype: cosName("Link"), Rect: cosArray([1,2,3,4].map(n => cosNumber(n))), NM: cosString("nameé😀"), T: cosString("title"), Subj: cosString("subject"), Contents: cosString("content"), C: cosArray([0.1,0.2,0.3].map(n => cosNumber(n))), Open: cosBool(true), M: cosString("date"), F: cosNumber(4), A: ref });
  if (mode === "dest") { dictDelete(annotation, "A"); dictSet(annotation, "Dest", cosArray([second.ref])); }
  if (mode === "array-action") dictSet(annotation, "A", cosArray([ref, ref]));
  if (mode !== "empty") { const entry = mode === "direct" ? annotation : doc.cos.allocateObject(annotation); dictSet(page.dict, "Annots", cosArray(mode === "repeat" ? [entry, entry] : [entry])); }
  const bytes = mode === "invalid" ? new TextEncoder().encode("not PDF") : doc.save((mode === "encrypted" || mode === "wrong-password") ? { encrypt: { userPassword: "secret", ownerPassword: "owner" } } : {});
  const args = [mode === "stdin" ? "-" : "A=in.pdf", ...(mode === "multiple" ? ["B=in.pdf"] : mode === "second-invalid" ? ["B=bad.pdf"] : []), ...(mode === "encrypted" ? ["input_pw", "A=secret"] : mode === "wrong-password" ? ["input_pw", "A=bad"] : []), mode === "utf8" ? "dump_data_annots_utf8" : "dump_data_annots", ...(mode === "file" ? ["output", "out.txt"] : [])];
  const files = new Map<string, Uint8Array>(); if (mode !== "missing") files.set(mode === "stdin" ? "-" : "in.pdf", bytes);
  if (mode === "second-invalid") files.set("bad.pdf", new TextEncoder().encode("bad"));
  const expected = await runPdftkCli(args, files), fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); if (mode !== "missing") await fs.writeFile("/in.pdf", bytes);
  if (mode === "second-invalid") await fs.writeFile("/bad.pdf", files.get("bad.pdf")!);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file inspection I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args), out: Uint8Array[] = [], err: Uint8Array[] = [];
  const result = await createPdftkCommand().execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: new AbortController().signal, stdin: (async function* () { if (mode === "stdin") yield bytes; })(), stdout: { async write(b) { out.push(b.slice()); } }, stderr: { async write(b) { err.push(b.slice()); } } });
  expect(result.exitCode).toBe(expected.exitCode); expect(text(out)).toBe(expected.stdout); expect(text(err)).toBe(expected.stderr);
  if (files.has("out.txt")) expect(await fs.readFile("/out.txt")).toEqual(files.get("out.txt"));
  expect(await fs.readdir("/scratch")).toEqual([]);
});

for (const mode of ["slow", "cancel", "write", "input-limit", "sink", "missing-parent"]) it(`preserves retained inspection ownership after ${mode}`, async () => {
  const doc = PdfDocument.create(), page = doc.addPage();
  const annotation = doc.cos.allocateObject(cosDict({ Subtype: cosName("Text"), Contents: cosString("é😀".repeat(18000)) }));
  dictSet(page.dict, "Annots", cosArray([annotation, annotation]));
  const bytes = doc.save(), fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", bytes); await fs.writeFile("/out.txt", new TextEncoder().encode("original"));
  const controller = new AbortController(), reason = new Error("injected report failure");
  let outstanding = 0, peak = 0, opens = 0, closes = 0, injected = false, written = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file inspection I/O forbidden"); };
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => { const handle = await fs.openReadFile!(...args); opens++; return { ...handle, async close() { closes++; await handle.close(); } }; };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(chunk: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        outstanding += chunk.length; peak = Math.max(peak, outstanding); expect(chunk.buffer.byteLength).toBeLessThanOrEqual(65536);
        try {
          if (!injected && new TextDecoder().decode(chunk).includes("AnnotContents:")) {
            if (mode === "cancel") { injected = true; controller.abort(reason); }
            else if (mode === "write") { injected = true; throw reason; }
          }
          await Promise.resolve(); return await writer.write(chunk, options);
        } finally { outstanding -= chunk.length; }
      } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const args = ["in.pdf", "dump_data_annots", "output", mode === "slow" || mode === "sink" ? "-" : mode === "missing-parent" ? "/missing/out.txt" : "out.txt"], carrier = createCommandArguments(args);
  const execute = async () => createPdftkCommand(mode === "input-limit" ? { limits: { maxInputBytes: bytes.length - 1 } } : {}).execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: controller.signal, stdin: (async function* () {})(), stdout: { async write(chunk) { if (mode === "sink") throw reason; written += chunk.length; expect(chunk.buffer.byteLength).toBeLessThanOrEqual(65536); await Promise.resolve(); } }, stderr: { async write() {} } });
  if (mode === "slow") { expect((await execute()).exitCode).toBe(0); expect(written).toBeGreaterThan(100000); }
  else if (mode === "missing-parent") expect((await execute()).exitCode).toBe(1);
  else if (mode === "input-limit") await expect(execute()).rejects.toThrow(/limit/);
  else await expect(execute()).rejects.toBe(reason);
  expect(opens).toBe(closes); expect(outstanding).toBe(0); expect(peak).toBeLessThanOrEqual(65536);
  expect(await fs.readFile("/out.txt")).toEqual(new TextEncoder().encode("original")); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("consumes generated stdin streams without collecting the payload", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const chunk = new Uint8Array(8192).fill(42); let produced = 0;
  async function* objects() {
    yield { objectNumber: 1, generationNumber: 0, value: cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }) };
    yield { objectNumber: 2, generationNumber: 0, value: cosDict({ Type: cosName("Pages"), Kids: cosArray([]), Count: cosNumber(0) }) };
    yield { objectNumber: 3, generationNumber: 0, value: cosDict({ Length: cosNumber(chunk.length * 64) }), stream: { length: chunk.length * 64, chunks: (async function* () { for (let n = 0; n < 64; n++) { produced++; yield chunk; } })() } };
  }
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file inspection I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const args = createCommandArguments(["-", "dump_data_annots"]), chunks: Uint8Array[] = [];
  const result = await createPdftkCommand().execute({ command: "pdftk", args: args.args, argumentValues: args, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: new AbortController().signal, stdin: serializeRetainedCosDocumentChunks({ rootRef: cosRef(1), objects: objects() }, { fs: guarded, directory: "/scratch" }), stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(0); expect(produced).toBe(64); expect(text(chunks)).toBe("PdfID0: 00000000000000000000000000000000\nPdfID1: 00000000000000000000000000000000\nNumberOfPages: 0\n"); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("spills a wide action worklist to injected backing", async () => {
  const doc = PdfDocument.create(), page = doc.addPage();
  const actions = Array.from({ length: 160 }, (_, index) => doc.cos.allocateObject(cosDict({ S: cosName("URI"), URI: cosString(`https://example.com/${index}`) })));
  dictSet(page.dict, "Annots", cosArray([doc.cos.allocateObject(cosDict({ Subtype: cosName("Link"), A: cosArray(Array.from({ length: 20 }, () => actions).flat()) }))]));
  const input = doc.save(), args = createCommandArguments(["in.pdf", "dump_data_annots"]), expected = await runPdftkCli(args.args, new Map([["in.pdf", input]]));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  let backingBytes = 0, peak = 0, pending = 0, opened = 0, closed = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file worklist I/O forbidden"); };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args); opened++;
      return new Proxy(handle, { get(target, property) {
        if (property === "write") return async (...args: Parameters<typeof handle.write>) => {
          const bytes = args[0].byteLength; pending += bytes; backingBytes += bytes; peak = Math.max(peak, pending);
          try { await Promise.resolve(); return await handle.write(...args); } finally { pending -= bytes; }
        };
        if (property === "close") return async (...args: Parameters<typeof handle.close>) => { closed++; await handle.close(...args); };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const output: Uint8Array[] = [];
  const result = await createPdftkCommand().execute({ command: "pdftk", args: args.args, argumentValues: args, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes) { output.push(bytes.slice()); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(0); expect(text(output)).toBe(expected.stdout); expect(backingBytes).toBeGreaterThan(160 * 32); expect(peak).toBeLessThanOrEqual(65536); expect(pending).toBe(0); expect(opened).toBe(closed); expect(await fs.readdir("/scratch")).toEqual([]);
});

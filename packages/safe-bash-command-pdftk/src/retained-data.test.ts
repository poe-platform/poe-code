import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosString, dictSet, dictDelete } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand, runPdftkCli } from "./index.js";

for (const mode of ["basic", "utf8", "info", "empty", "bookmarks", "cycle", "named", "labels", "boxes", "inherited", "malformed-box", "file", "stdin", "encrypted", "large"]) it(`streams ${mode} document reports with exact compatibility bytes`, async () => {
  const doc = PdfDocument.create(), page = doc.addPage(), second = doc.addPage();
  doc.setTitle(mode === "large" ? "更新😀".repeat(18000) : "Titleé😀");
  const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
  if (mode === "info") {
    const info = doc.cos.resolveDict(doc.cos.infoRef)!;
    dictSet(info, "Author", cosName("ignored")); dictSet(info, "Custom", cosString("custom"));
    info.entries.push({ key: cosName("Custom"), value: cosString("later") });
    dictSet(info, "CreationDate", cosString("D:20200101000000Z"));
  }
  if (["bookmarks", "cycle", "named"].includes(mode)) {
    const child = doc.cos.allocateObject(cosDict({ Title: cosName("child"), Dest: cosArray([cosNumber(0.5)]) }));
    const first = doc.cos.allocateObject(cosDict({ Title: cosString("Firsté"), Dest: mode === "named" ? cosString("target") : cosArray([second.ref]), First: child }));
    dictSet(catalog, "Outlines", cosDict({ First: first }));
    dictSet(doc.cos.resolveDict(first)!, "Next", mode === "cycle" ? first : doc.cos.allocateObject(cosDict({ Title: cosString("last"), A: cosDict({ S: cosName("GoTo"), D: cosArray([page.ref]) }) })));
    if (mode === "named") dictSet(catalog, "Names", cosDict({ Dests: cosDict({ Kids: cosArray([cosDict({ Names: cosArray([cosString("target"), cosDict({ D: cosArray([second.ref]) })]) })]) }) }));
  }
  if (mode === "labels") {
    const labels = doc.cos.allocateObject(cosDict({ Nums: cosArray([cosNumber(1), cosDict({ S: cosName("r"), St: cosNumber(2), P: cosString("préfix") }), cosNumber(-3), cosDict({ S: cosName("D") })]) }));
    dictSet(doc.cos.resolveDict(labels)!, "Kids", cosArray([labels, cosDict({ Nums: cosArray([cosNumber(0), cosDict({ S: cosName("A") })]) })]));
    dictSet(catalog, "PageLabels", labels);
  }
  if (mode === "boxes") { dictSet(page.dict, "MediaBox", cosArray([30, 40, 10, 20].map(n => cosNumber(n)))); dictSet(page.dict, "CropBox", cosArray([1, 2, 3, 4].map(n => cosNumber(n)))); dictSet(page.dict, "Rotate", cosNumber(-90)); }
  if (mode === "malformed-box") dictSet(page.dict, "MediaBox", cosArray([cosNumber(1), cosName("bad"), cosNumber(3), cosNumber(4)]));
  if (mode === "inherited") { dictDelete(page.dict, "MediaBox"); const parent = doc.cos.resolveDict(catalog.entries.find(entry => entry.key.decoded === "Pages")!.value)!; dictSet(parent, "MediaBox", cosArray([5, 10, 205, 110].map(n => cosNumber(n)))); dictSet(parent, "Rotate", cosNumber(90)); }
  if (mode === "empty") { const pages = doc.cos.resolveDict(catalog.entries.find(entry => entry.key.decoded === "Pages")!.value)!; dictSet(pages, "Kids", cosArray([])); dictSet(pages, "Count", cosNumber(0)); }
  const bytes = doc.save(mode === "encrypted" ? { encrypt: { userPassword: "secret", ownerPassword: "owner" } } : {});
  const args = [mode === "stdin" ? "-" : "in.pdf", ...(mode === "encrypted" ? ["input_pw", "secret"] : []), mode === "utf8" ? "dump_data_utf8" : "dump_data", ...(mode === "file" ? ["output", "out.txt"] : [])];
  const files = new Map([[mode === "stdin" ? "-" : "in.pdf", bytes]]), expected = await runPdftkCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", bytes);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file report I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args), decoder = new TextDecoder(); let actual = "", errors = "";
  const result = await createPdftkCommand().execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: new AbortController().signal, stdin: (async function* () { if (mode === "stdin") yield bytes; })(), stdout: { async write(chunk) { expect(chunk.buffer.byteLength).toBeLessThanOrEqual(65536); actual += decoder.decode(chunk, { stream: true }); await Promise.resolve(); } }, stderr: { async write(chunk) { errors += new TextDecoder().decode(chunk); } } });
  actual += decoder.decode(); expect(result.exitCode).toBe(expected.exitCode); expect(actual).toBe(expected.stdout); expect(errors).toBe(expected.stderr);
  if (files.has("out.txt")) expect(await fs.readFile("/out.txt")).toEqual(files.get("out.txt")); expect(await fs.readdir("/scratch")).toEqual([]);
});

for (const mode of ["slow", "cancel", "write", "input-limit", "sink", "missing-parent"]) it(`preserves retained document report ownership after ${mode}`, async () => {
  const doc = PdfDocument.create(); doc.addPage();
  doc.setTitle("é😀".repeat(36000));
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
          if (!injected && new TextDecoder().decode(chunk).includes("InfoValue:")) {
            if (mode === "cancel") { injected = true; controller.abort(reason); }
            else if (mode === "write") { injected = true; throw reason; }
          }
          await Promise.resolve(); return await writer.write(chunk, options);
        } finally { outstanding -= chunk.length; }
      } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const args = ["in.pdf", "dump_data", "output", mode === "slow" || mode === "sink" ? "-" : mode === "missing-parent" ? "/missing/out.txt" : "out.txt"], carrier = createCommandArguments(args);
  const execute = async () => createPdftkCommand(mode === "input-limit" ? { limits: { maxInputBytes: bytes.length - 1 } } : {}).execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: controller.signal, stdin: (async function* () {})(), stdout: { async write(chunk) { if (mode === "sink") throw reason; written += chunk.length; expect(chunk.buffer.byteLength).toBeLessThanOrEqual(65536); await Promise.resolve(); } }, stderr: { async write() {} } });
  if (mode === "slow") { expect((await execute()).exitCode).toBe(0); expect(written).toBeGreaterThan(100000); }
  else if (mode === "missing-parent") expect((await execute()).exitCode).toBe(1);
  else if (mode === "input-limit") await expect(execute()).rejects.toThrow(/limit/);
  else await expect(execute()).rejects.toBe(reason);
  expect(opens).toBe(closes); expect(outstanding).toBe(0); expect(peak).toBeLessThanOrEqual(65536);
  expect(await fs.readFile("/out.txt")).toEqual(new TextEncoder().encode("original")); expect(await fs.readdir("/scratch")).toEqual([]);
});


for (const count of [1200, 2400]) it(`spills ${count} pending label branches through bounded caller writes`, async () => {
  const doc = PdfDocument.create(); doc.addPage();
  const label = doc.cos.allocateObject(cosDict({ Nums: cosArray([cosNumber(0), cosDict({ S: cosName("D"), P: cosString("prefix") })]) }));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "PageLabels", cosDict({ Kids: cosArray(Array.from({ length: count }, () => label)) }));
  const input = doc.save(), args = createCommandArguments(["in.pdf", "dump_data"]), expected = await runPdftkCli(args.args, new Map([["in.pdf", input]]));
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
  expect(result.exitCode).toBe(0); expect(new TextDecoder().decode(Uint8Array.from(output.flatMap(chunk => Array.from(chunk))))).toBe(expected.stdout); expect(backingBytes).toBeGreaterThan(count * 32); expect(peak).toBeLessThanOrEqual(65536); expect(pending).toBe(0); expect(opened).toBe(closed); expect(await fs.readdir("/scratch")).toEqual([]);
});

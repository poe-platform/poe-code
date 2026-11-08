import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosBool, cosDict, cosName, cosNumber, cosString, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand, runPdftkCli } from "./index.js";

for (const mode of ["text", "utf8", "choice", "checkbox", "default-on", "off", "widgets", "inherited", "empty", "unknown", "file", "stdin", "encrypted", "large"]) it(`streams ${mode} field reports with exact compatibility bytes`, async () => {
  const doc = PdfDocument.create(); doc.addPage();
  const field = cosDict({ T: cosString("fieldé😀"), FT: cosName(mode === "choice" ? "Ch" : ["checkbox", "default-on", "off", "widgets"].includes(mode) ? "Btn" : mode === "unknown" ? "Other" : "Tx"),
    V: mode === "choice" ? cosArray([cosString("first"), cosName("second")]) : mode === "off" ? cosName("Off") : ["checkbox", "default-on", "widgets"].includes(mode) ? cosBool(true) : cosString(mode === "large" ? "更新😀".repeat(18000) : "value"),
    Opt: cosArray([cosString("one"), cosString("one"), cosArray([cosString("export"), cosString("display")])]), Ff: cosNumber(17), Q: cosNumber(2), MaxLen: cosNumber(99), TU: cosString("alt"), DV: cosString("default") });
  if (mode === "checkbox") dictSet(field, "AP", cosDict({ N: cosDict({ Off: cosDict({}), Checked: cosDict({}) }) }));
  if (mode === "widgets") dictSet(field, "Kids", cosArray([cosDict({ AP: cosDict({ N: cosDict({ Off: cosDict({}), Custom: cosDict({}) }) }) })]));
  const ref = doc.cos.allocateObject(field); let root = ref;
  if (mode === "inherited") { root = doc.cos.allocateObject(cosDict({ T: cosString("parent"), FT: cosName("Tx"), V: cosString("inherited"), Ff: cosNumber(15), Q: cosNumber(1), Kids: cosArray([ref]) })); field.entries.splice(0, field.entries.length, { key: cosName("T"), value: cosString("child") }, { key: cosName("Parent"), value: root }); }
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray(mode === "empty" ? [] : [root, root]) }));
  const bytes = doc.save(mode === "encrypted" ? { encrypt: { userPassword: "secret", ownerPassword: "owner" } } : {});
  const args = [mode === "stdin" ? "-" : "in.pdf", ...(mode === "encrypted" ? ["input_pw", "secret"] : []), mode === "utf8" ? "dump_data_fields_utf8" : "dump_data_fields", ...(mode === "file" ? ["output", "out.txt"] : [])];
  const files = new Map([[mode === "stdin" ? "-" : "in.pdf", bytes]]), expected = await runPdftkCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", bytes);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file field I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args), decoder = new TextDecoder(); let actual = "", errors = "";
  const result = await createPdftkCommand().execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: new AbortController().signal, stdin: (async function* () { if (mode === "stdin") yield bytes; })(), stdout: { async write(chunk) { expect(chunk.buffer.byteLength).toBeLessThanOrEqual(65536); actual += decoder.decode(chunk, { stream: true }); await Promise.resolve(); } }, stderr: { async write(chunk) { errors += new TextDecoder().decode(chunk); } } });
  actual += decoder.decode(); expect(result.exitCode).toBe(expected.exitCode); expect(actual).toBe(expected.stdout); expect(errors).toBe(expected.stderr);
  if (files.has("out.txt")) expect(await fs.readFile("/out.txt")).toEqual(files.get("out.txt")); expect(await fs.readdir("/scratch")).toEqual([]);
});

for (const mode of ["slow", "cancel", "write", "input-limit", "sink", "missing-parent"]) it(`preserves retained field report ownership after ${mode}`, async () => {
  const doc = PdfDocument.create(); doc.addPage();
  const field = doc.cos.allocateObject(cosDict({ T: cosString("field"), FT: cosName("Tx"), V: cosString("é😀".repeat(18000)) }));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([field, field]) }));
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
          if (!injected && new TextDecoder().decode(chunk).includes("FieldValue:")) {
            if (mode === "cancel") { injected = true; controller.abort(reason); }
            else if (mode === "write") { injected = true; throw reason; }
          }
          await Promise.resolve(); return await writer.write(chunk, options);
        } finally { outstanding -= chunk.length; }
      } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const args = ["in.pdf", "dump_data_fields", "output", mode === "slow" || mode === "sink" ? "-" : mode === "missing-parent" ? "/missing/out.txt" : "out.txt"], carrier = createCommandArguments(args);
  const execute = async () => createPdftkCommand(mode === "input-limit" ? { limits: { maxInputBytes: bytes.length - 1 } } : {}).execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: controller.signal, stdin: (async function* () {})(), stdout: { async write(chunk) { if (mode === "sink") throw reason; written += chunk.length; expect(chunk.buffer.byteLength).toBeLessThanOrEqual(65536); await Promise.resolve(); } }, stderr: { async write() {} } });
  if (mode === "slow") { expect((await execute()).exitCode).toBe(0); expect(written).toBeGreaterThan(100000); }
  else if (mode === "missing-parent") expect((await execute()).exitCode).toBe(1);
  else if (mode === "input-limit") await expect(execute()).rejects.toThrow(/limit/);
  else await expect(execute()).rejects.toBe(reason);
  expect(opens).toBe(closes); expect(outstanding).toBe(0); expect(peak).toBeLessThanOrEqual(65536);
  expect(await fs.readFile("/out.txt")).toEqual(new TextEncoder().encode("original")); expect(await fs.readdir("/scratch")).toEqual([]);
});


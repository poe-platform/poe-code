import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosStream, cosString, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand, runPdftkCli } from "./index.js";

for (const mode of ["plain", "stdout", "stdin", "drop_xfa", "drop_xmp", "need_appearances", "indirect-form", "compress", "uncompress", "both", "encrypted", "keep_first_id", "keep_final_id", "duplicate-handle", "encrypt-output"]) it(`rewrites ${mode} output with exact compatibility bytes`, async () => {
  const doc = PdfDocument.create(); doc.addPage().drawText("Hello", { x: 10, y: 20 });
  const root = doc.cos.resolveDict(doc.cos.rootRef)!, form = cosDict({ Fields: cosArray([]), XFA: cosString("xml") });
  dictSet(root, "AcroForm", mode === "indirect-form" ? doc.cos.allocateObject(form) : form);
  dictSet(root, "Metadata", doc.cos.allocateObject(cosStream(cosDict({ Type: cosName("Metadata") }), new TextEncoder().encode("metadata"))));
  doc.cos.idArray = cosArray([cosString("first"), cosString("first")]);
  const second = PdfDocument.create(); second.addPage(); second.cos.idArray = cosArray([cosString("last"), cosString("last")]);
  const input = doc.save(mode === "encrypted" ? { encrypt: { userPassword: "secret", ownerPassword: "owner" } } : {}), other = second.save();
  const flags = ["drop_xfa", "drop_xmp", "need_appearances", "compress", "uncompress", "keep_first_id", "keep_final_id"].includes(mode) ? [mode] : mode === "indirect-form" ? ["drop_xfa", "need_appearances"] : mode === "both" ? ["compress", "uncompress"] : [];
  const args = [mode === "duplicate-handle" ? "A=other.pdf" : mode === "stdin" ? "-" : "in.pdf", ...(mode === "duplicate-handle" ? ["A=in.pdf"] : []), ...(mode.startsWith("keep_") ? ["other.pdf"] : []), ...(mode === "encrypted" ? ["input_pw", "secret"] : []), "output", mode === "stdout" ? "-" : "out.pdf", ...flags, ...(mode === "encrypt-output" ? ["user_pw", "reader", "owner_pw", "owner", "allow", "Printing"] : [])];
  const files = new Map([[mode === "stdin" ? "-" : "in.pdf", input], ["other.pdf", other]]), expected = await runPdftkCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/other.pdf", other);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file output I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args), output: Uint8Array[] = []; let errors = "";
  const result = await createPdftkCommand().execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* () { if (mode === "stdin") yield input; })(), stdout: { async write(bytes) { expect(bytes.buffer.byteLength).toBeLessThanOrEqual(65536); output.push(bytes.slice()); await Promise.resolve(); } }, stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode).toBe(expected.exitCode); expect(errors).toBe(expected.stderr);
  const actual = mode === "stdout" ? Uint8Array.from(output.flatMap(chunk => Array.from(chunk))) : await fs.readFile("/out.pdf");
  if (mode === "encrypt-output") {
    const decoded = PdfDocument.load(actual, { password: "reader" });
    const compatible = PdfDocument.load(files.get("out.pdf")!, { password: "reader" });
    expect(decoded.getPages().length).toBe(compatible.getPages().length);
    expect(decoded.extractText()).toBe(compatible.extractText());
    expect(() => PdfDocument.load(actual, { password: "wrong" })).toThrow();
  } else expect(actual).toEqual(mode === "stdout" ? expected.stdoutBytes : files.get("out.pdf")); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["cancel", "sink", "staging"])("releases output backing after %s failure", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const doc = PdfDocument.create(); doc.addPage().drawText("cleanup", { x: 10, y: 10 }); await fs.writeFile("/in.pdf", doc.save());
  const controller = new AbortController(), reason = new Error("output failed");
  const guarded = new Proxy(fs, { get(owner, key) {
    if (mode === "staging" && key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const file = await fs.createStagedFile!(...args); return { ...file, writer: { ...file.writer!, write: async () => { throw reason; } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const args = createCommandArguments(["in.pdf", "output", "-", "compress"]);
  await expect(createPdftkCommand().execute({ command: "pdftk", args: args.args, argumentValues: args, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* () {})(), stdout: { async write() { if (mode === "cancel") controller.abort(reason); else throw reason; } }, stderr: { async write() {} } })).rejects.toBe(reason);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

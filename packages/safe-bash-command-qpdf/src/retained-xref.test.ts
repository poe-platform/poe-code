import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosStream, cosArray, cosDict, cosName, dictGet, dictSet, serializeCosDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["plain", "encrypted", "empty", "compressed", "repaired", "broken-previous", "incremental", "inline"]) for (const flags of [["--show-xref"], ["--show-xref", "--show-object=1"], ["--check", "--show-xref"]]) {
  it(`inspects ${mode} retained input with exact diagnostics: ${flags.join(" ")}`, async () => {
    const doc = PdfDocument.create(); if (mode !== "empty") doc.addPage().drawText("Inspect", { x: 10, y: 20 });

    let input = doc.save(mode === "encrypted" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : mode === "compressed" || mode === "broken-previous" || mode === "incremental" ? { objectStreams: "generate" } : {});
    if (mode === "broken-previous" || mode === "incremental") {
      const text = new TextDecoder().decode(input), previous = Number(text.slice(text.lastIndexOf("startxref") + 9).split("%%EOF")[0]!.trim());
      const latest = input.length;
      input = new Uint8Array(Buffer.concat([input, Buffer.from(`\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Root ${doc.cos.rootRef.objectNumber} 0 R /Size 100 /Prev ${mode === "incremental" ? previous : 1} >>\nstartxref\n${latest + 1}\n%%EOF\n`)]));
    }
    if (mode === "inline") {
      const root = doc.cos.resolveDict(dictGet(doc.cos.resolveDict(doc.cos.rootRef)!, "Pages"))!;
      dictSet(root, "Kids", cosArray([cosDict({ Type: cosName("Page") }), cosDict({ Type: cosName("Page") })]));
      input = serializeCosDocument({ objects: [...doc.cos.objects.values()], rootRef: doc.cos.rootRef });
    }
    if (mode === "repaired") { const end = Buffer.from(input).lastIndexOf("startxref"); input = new Uint8Array(Buffer.concat([input.subarray(0, end), Buffer.from("startxref\n0\n%%EOF\n")])); }
    const args = [...flags, ...(mode === "encrypted" ? ["--password=reader"] : []), "in.pdf"], expected = await runQpdfCli(args, new Map([["in.pdf", input]]));
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
      if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
      const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
    } });
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
      stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); await Promise.resolve(); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } } });
    assert.equal(result.exitCode, expected.exitCode); assert.equal(Buffer.concat(stdout).toString(), expected.stdout); assert.equal(Buffer.concat(stderr).toString(), expected.stderr); assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}

for (const mode of ["budget", "staging", "stdout", "cancel"]) it(`releases xref-output backing after ${mode} failure`, async () => {
  const doc = PdfDocument.create(); doc.addPage(); doc.cos.allocateObject(cosStream(new Uint8Array(131072).fill(65), { compress: true }));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", doc.save());
  const reason = new Error("injected xref-output failure"), controller = new AbortController(); let writes = 0;
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args); if (mode !== "staging" || args[1] !== "bytes") return staged;
      return { ...staged, writer: { ...staged.writer!, write: async () => { throw reason; } } };
    };
    const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const carrier = createCommandArguments(["--show-xref", "in.pdf"]);
  const context = { command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write() { writes++; if (mode === "stdout") throw reason; if (mode === "cancel") controller.abort(reason); } }, stderr: { async write() {} } };
  await assert.rejects(async () => createQpdfCommand({ limits: mode === "budget" ? { maxOutputBytes: 1 } : {} }).execute(context), error => mode === "budget" ? error instanceof Error && error.message.toLowerCase().includes("limit") : error === reason);
  assert.equal(writes, mode === "budget" || mode === "staging" ? 0 : 1); assert.deepEqual(await fs.readdir("/scratch"), []);
});

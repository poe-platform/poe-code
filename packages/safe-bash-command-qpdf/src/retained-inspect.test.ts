import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosDict, cosNumber } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["plain", "encrypted", "empty", "linearized", "repaired"]) for (const flags of [["--check"], ["--show-npages"], ["--show-encryption"], ["--check", "--show-npages", "--show-encryption"]]) {
  it(`inspects ${mode} retained input with exact diagnostics: ${flags.join(" ")}`, async () => {
    const doc = PdfDocument.create(); if (mode !== "empty") doc.addPage().drawText("Inspect", { x: 10, y: 20 });
    if (mode === "linearized") doc.cos.allocateObject(cosDict({ Linearized: cosNumber(1) }));
    let input = doc.save(mode === "encrypted" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : {});
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

it("rejects inspection output budgets before writing stdout and releases backing", async () => {
  const doc = PdfDocument.create(); doc.addPage(); const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", doc.save());
  const carrier = createCommandArguments(["--check", "in.pdf"]); let written = 0;
  await assert.rejects(async () => createQpdfCommand({ limits: { maxOutputBytes: 1 } }).execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { written += bytes.length; } }, stderr: { async write() {} } }), /limit/i);
  assert.equal(written, 0); assert.deepEqual(await fs.readdir("/scratch"), []);
});

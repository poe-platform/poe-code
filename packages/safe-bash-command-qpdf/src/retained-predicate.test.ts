import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["plain", "encrypted", "malformed", "boundary", "repaired"]) for (const password of [undefined, "reader", "wrong"]) for (const flag of ["--is-encrypted", "--requires-password"]) {
  it(`streams ${flag} for ${mode} input with password ${password}`, async () => {
    const doc = PdfDocument.create(); doc.addPage().drawText("Predicate", { x: 10, y: 20 });
    let input = doc.save(mode === "encrypted" || mode === "repaired" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : {});
    if (mode === "malformed") input = new TextEncoder().encode("not a PDF /Encrypt");
    if (mode === "boundary") { input = new Uint8Array(131072).fill(32); input.set(new TextEncoder().encode("/Encrypt"), 65533); }
    if (mode === "repaired") { const end = Buffer.from(input).lastIndexOf("startxref"); input = new Uint8Array(Buffer.concat([input.subarray(0, end), Buffer.from("startxref\n0\n%%EOF\n")])); }
    const args = [flag, ...(password === undefined ? [] : [`--password=${password}`]), "in.pdf"], expected = await runQpdfCli(args, new Map([["in.pdf", input]]));
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
      if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
      const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
    } });
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
      stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } } });
    assert.equal(result.exitCode, expected.exitCode); assert.equal(Buffer.concat(stdout).toString(), expected.stdout); assert.equal(Buffer.concat(stderr).toString(), expected.stderr); assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}

for (const mode of ["cancel", "read-failure", "budget"]) it(`releases predicate input after ${mode}`, async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const controller = new AbortController(), reason = new Error("injected predicate failure");
  let closed = 0, reads = 0;
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...args);
      return { ...handle, async read(...parameters: Parameters<typeof handle.read>) {
        reads++; assert.ok(parameters[1] <= 65536);
        if (mode === "cancel") controller.abort(reason);
        if (mode === "read-failure") throw reason;
        return handle.read(...parameters);
      }, async close() { closed++; await handle.close(); } };
    };
    const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const carrier = createCommandArguments(["--is-encrypted", "-"]);
  await assert.rejects(async () => createQpdfCommand({ limits: mode === "budget" ? { maxInputBytes: 1 } : {} }).execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* () { const chunk = new Uint8Array(65536).fill(32); yield chunk; yield chunk; })(),
    stdout: { async write() { assert.fail("Unexpected output"); } }, stderr: { async write() { assert.fail("Unexpected diagnostic"); } } }),
  error => mode === "budget" ? error instanceof Error && error.message.toLowerCase().includes("limit") : error === reason);
  assert.equal(reads, mode === "budget" ? 0 : 1); assert.equal(closed, mode === "budget" ? 0 : 1);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

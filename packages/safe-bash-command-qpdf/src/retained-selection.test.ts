import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosStream, cosString, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["plain", "encrypted", "source-password", "stdin", "source-stdin", "empty", "empty-no-pages", "none", "duplicate", "stdout", "replace", "remove", "remove-large", "decrypt", "collate", "collate-two", "collate-large", "collate-single", "collate-empty", "rotate-absolute", "rotate-relative", "rotate-duplicates", "rotate-collated", "rotate-plain"]) it(`copies ${mode} page selections through retained storage with exact bytes`, async () => {
  const base = PdfDocument.create(), other = PdfDocument.create();
  for (let i = 0; i < 3; i++) base.addPage([100 + i * 10, 200]).drawText(`Base ${i + 1}`, { x: 10, y: 20 });
  for (let i = 0; i < 2; i++) other.addPage([200 + i * 10, 300]).drawText(`Other ${i + 1}`, { x: 10, y: 20 });
  base.setTitle(mode === "remove-large" ? "x".repeat(200000) : "Base title"); base.setAuthor("Base author"); other.setTitle("Other title");
  dictSet(base.cos.resolveDict(base.cos.infoRef)!, "Subject", cosString("Not copied by qpdf"));
  dictSet(base.cos.resolveDict(base.cos.infoRef)!, "Producer", cosString("Source producer"));
  base.cos.allocateObject(cosStream(new Uint8Array(131072).fill(65), { compress: false }));
  const encrypted = mode === "encrypted" || mode === "decrypt";
  const input = base.save(encrypted ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : {});
  const extra = other.save(mode === "source-password" ? { encrypt: { userPassword: "other", ownerPassword: "owner" } } : {});
  const mainName = mode === "stdin" ? "-" : "in.pdf", otherName = mode === "source-stdin" ? "-" : "other.pdf";
  const target = mode === "stdout" ? "-" : mode === "replace" ? mainName : "out.pdf";
  const args = [...(mode.startsWith("rotate") ? [mode === "rotate-absolute" ? "--rotate=270:1-z" : mode === "rotate-duplicates" ? "--rotate=+90:1-z,1" : "--rotate=+90:1-z", "--rotate=-180:2-z"] : []), ...(mode.startsWith("collate") || mode === "rotate-collated" ? [`--collate=${mode === "collate-two" ? 2 : mode === "collate-large" ? 100000000 : 1}`] : []), ...(encrypted ? ["--password=reader"] : []), ...(mode.startsWith("empty") ? ["--empty"] : [mainName]),
    ...(mode === "replace" ? ["--replace-input"] : []), ...(mode.startsWith("remove") ? ["--remove-info", "--remove-metadata"] : []), ...(mode === "decrypt" ? ["--decrypt"] : []),
    ...(mode === "empty-no-pages" || mode === "rotate-plain" ? [] : ["--pages", ...(mode === "empty" ? [] : [".", mode === "none" || mode === "collate-empty" ? "1-z,x1-z" : mode.startsWith("collate") ? "3-1,1" : "3-1,x2"]),
      ...(mode === "none" || mode === "collate-single" ? [] : [otherName, ...(mode === "source-password" ? ["--password=other"] : []), "1-z"]), ...(mode === "duplicate" ? [".", "2,2"] : []), "--"]),
    ...(mode === "replace" ? [] : [target])];
  const files = new Map([[mainName, input], [otherName, extra]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/other.pdf", extra);
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args), stdin = mode === "source-stdin" ? extra : input;
  const result = await createQpdfCommand({ limits: { maxInputBytes: input.length + extra.length, ...(mode === "remove-large" ? { maxOutputBytes: files.get(target)!.length } : {}) } }).execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* () { for (let offset = 0; offset < stdin.length; offset += 4096) yield stdin.subarray(offset, offset + 4096); })(),
    stdout: { async write(bytes: Uint8Array) { assert.ok(bytes.buffer.byteLength <= 65536); stdout.push(bytes.slice()); await Promise.resolve(); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } } });
  assert.equal(result.exitCode, expected.exitCode); assert.equal(Buffer.concat(stderr).toString(), expected.stderr);
  assert.deepEqual(target === "-" ? new Uint8Array(Buffer.concat(stdout)) : await fs.readFile(`/${target}`), files.get(target));
  assert.deepEqual(await fs.readdir("/scratch"), []); assert.equal((await fs.readdir("/")).some(entry => entry.name.startsWith(".pdf-")), false);
});

for (const collate of [false, true]) for (const mode of ["read", "cancel", "budget", "identity"]) it(`preserves retained ${collate ? "collated " : ""}merge inputs and publication during ${mode}`, async () => {
  const first = PdfDocument.create(), second = PdfDocument.create(), replacement = PdfDocument.create();
  first.addPage([100, 200]); second.addPage([300, 400]); replacement.addPage([500, 600]);
  const input = first.save(), extra = second.save(), previous = new Uint8Array([9]);
  const args = [...(collate ? ["--collate=1"] : []), "in.pdf", "--pages", ".", "1", "other.pdf", "1", ".", "1", "--", "out.pdf"], files = new Map([["in.pdf", input], ["other.pdf", extra]]);
  if (mode === "identity") await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/other.pdf", extra); await fs.writeFile("/replacement.pdf", replacement.save()); await fs.writeFile("/out.pdf", previous);
  const controller = new AbortController(), reason = new Error("injected merge read failure"); let opened = 0, closed = 0, reads = 0, replaced = false;
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
    if (key === "openReadFile") return async (...parameters: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...parameters), path = parameters[0];
      if (path !== "/in.pdf" && path !== "/other.pdf") return handle;
      opened++;
      return { ...handle, async read(...range: Parameters<typeof handle.read>) {
        reads++; assert.ok(range[1] <= 65536);
        if (mode === "identity" && !replaced) { replaced = true; assert.equal(opened, 2); await fs.rename("/replacement.pdf", "/other.pdf"); }
        if (path === "/other.pdf" && mode === "read") throw reason;
        if (path === "/other.pdf" && mode === "cancel") controller.abort(reason);
        return handle.read(...range);
      }, async close() { closed++; await handle.close(); } };
    };
    const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const carrier = createCommandArguments(args);
  const run = async () => createQpdfCommand({ limits: { maxInputBytes: input.length + extra.length - (mode === "budget" ? 1 : 0) } }).execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write() { assert.fail("Unexpected output"); } }, stderr: { async write() { assert.fail("Unexpected diagnostic"); } } });
  if (mode === "identity") { assert.equal((await run()).exitCode, 0); assert.deepEqual(await fs.readFile("/out.pdf"), files.get("out.pdf")); }
  else { await assert.rejects(run, error => mode === "budget" ? error instanceof Error && error.message.toLowerCase().includes("limit") : error === reason); assert.deepEqual(await fs.readFile("/out.pdf"), previous); }
  assert.equal(opened, 2); assert.equal(closed, 2); if (mode === "budget") assert.equal(reads, 0);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

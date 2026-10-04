import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["ordinary", "replace", "stdout", "stdin", "encrypted", "decrypt", "decrypt-plain", "repaired", "object-streams", "linearized", "linearized-stdout", "linearized-rotate", "generate-objects"]) it(`rewrites ${mode} through retained input and atomic streamed output`, async () => {
  const doc = PdfDocument.create(); doc.setTitle("Retained rewrite"); for (let i = 0; i < 4; i++) doc.addPage().drawText(`Page ${i}`, { x: 20, y: 30 });
  if (mode.startsWith("decrypt")) doc.setVersion("1.4");
  let input = doc.save(mode === "encrypted" || mode === "decrypt" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : mode === "object-streams" ? { objectStreams: "generate" } : mode.startsWith("linearized") ? { linearize: true } : {});
  if (mode === "repaired") { const end = Buffer.from(input).lastIndexOf("startxref"); input = new Uint8Array(Buffer.concat([input.subarray(0, end), Buffer.from("startxref\n0\n%%EOF\n")])); }
  const inputName = mode === "stdin" ? "-" : "in.pdf", outputName = mode === "replace" ? "in.pdf" : mode.endsWith("stdout") ? "-" : "out.pdf";
  const args = mode === "replace" ? ["--replace-input", inputName] : [inputName, outputName]; if (mode === "encrypted" || mode === "decrypt") args.unshift("--password=reader"); if (mode.startsWith("decrypt")) args.unshift("--decrypt"); if (mode === "linearized-rotate") args.unshift("--rotate=+90:1-z"); if (mode === "generate-objects") args.unshift("--object-streams=generate");
  const files = new Map([[inputName, input]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  let published = 0; const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole file I/O forbidden"); };
    if (key === "publishStagedFile") return async (...args: Parameters<NonNullable<typeof fs.publishStagedFile>>) => { published++; return fs.publishStagedFile!(...args); };
    const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const carrier = createCommandArguments(args);
  const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* () { for (let i = 0; i < input.length; i += 71) yield input.subarray(i, i + 71); })(),
    stdout: { async write(bytes: Uint8Array) { assert.ok(bytes.length <= 65536); stdout.push(bytes.slice()); await Promise.resolve(); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } } });
  assert.equal(result.exitCode, expected.exitCode); assert.equal(Buffer.concat(stderr).toString(), expected.stderr);
  assert.deepEqual(outputName === "-" ? new Uint8Array(Buffer.concat(stdout)) : await fs.readFile("/" + outputName), files.get(outputName));
  assert.equal(published, outputName === "-" ? 0 : 1); assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const mode of ["input", "output", "cancel", "write"]) for (const linearize of [false, true, "request"]) it(`preserves output and releases storage after ${mode} failure (linearize=${linearize})`, async () => {
  const doc = PdfDocument.create(); for (let i = 0; i < 128; i++) doc.addPage(); const input = doc.save({ linearize: linearize === true });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/out.pdf", new TextEncoder().encode("original"));
  const controller = new AbortController(), reason = new Error("injected failure"); let sourceReads = 0, published = 0;
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole file I/O forbidden"); };
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...args);
      return new Proxy(handle, { get(target, property) {
        if (property === "read") return async (...args: Parameters<typeof handle.read>) => { sourceReads++; if (mode === "cancel") controller.abort(reason); return handle.read(...args); };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args); if (mode !== "write" || args[1] !== "output") return staged;
      return { ...staged, writer: { ...staged.writer!, write: async () => { throw reason; } } };
    };
    if (key === "publishStagedFile") return async (...args: Parameters<NonNullable<typeof fs.publishStagedFile>>) => { published++; return fs.publishStagedFile!(...args); };
    const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const carrier = createCommandArguments(["in.pdf", "out.pdf", ...(linearize === "request" ? ["--linearize"] : [])]);
  const context = { command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write() {} }, stderr: { async write() {} } };
  const command = createQpdfCommand({ limits: mode === "input" ? { maxInputBytes: 1 } : mode === "output" ? { maxOutputBytes: 1 } : {} });
  await assert.rejects(async () => command.execute(context), error => mode === "cancel" || mode === "write" ? error === reason : error instanceof Error && error.message.toLowerCase().includes("limit"));
  if (mode === "input") assert.equal(sourceReads, 0);
  assert.equal(published, 0); assert.equal(new TextDecoder().decode(await fs.readFile("/out.pdf")), "original"); assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const mode of ["missing-input", "missing-output", "same-output", "damaged", "password", "arguments-budget"]) it(`preserves ${mode} diagnostics and input admission`, async () => {
  const doc = PdfDocument.create(); doc.addPage();
  const input = mode === "damaged" ? new TextEncoder().encode("broken") : doc.save(mode === "password" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : {});
  const args = mode === "missing-input" ? ["missing.pdf", "out.pdf"] : mode === "missing-output" ? ["in.pdf"] : mode === "same-output" ? ["in.pdf", "in.pdf"] : mode === "arguments-budget" ? ["@args.txt"] : ["in.pdf", "out.pdf"];
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); const argumentBytes = new TextEncoder().encode("in.pdf\nout.pdf\n"); await fs.writeFile("/args.txt", argumentBytes);
  const expected = await runQpdfCli(mode === "arguments-budget" ? ["in.pdf", "out.pdf"] : args, new Map([["in.pdf", input]]));
  const stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
  const context = { command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } } };
  if (mode === "arguments-budget") await assert.rejects(async () => createQpdfCommand({ limits: { maxInputBytes: input.length + argumentBytes.length - 1 } }).execute(context), /limit/i);
  else { const result = await createQpdfCommand().execute(context); assert.equal(result.exitCode, expected.exitCode); assert.equal(Buffer.concat(stderr).toString(), expected.stderr); }
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const count of [32, 128]) for (const linearize of [false, true]) it(`awaits bounded backing and publication writes for ${count} pages (linearize=${linearize})`, async () => {
  const doc = PdfDocument.create(); for (let i = 0; i < count; i++) doc.addPage().drawText("Growing", { x: 10, y: 20 });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", doc.save());
  let outstanding = 0, peak = 0, writes = 0;
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole file I/O forbidden"); };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, write: async (bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) => {
        assert.equal(outstanding, 0); outstanding += bytes.length; peak = Math.max(peak, outstanding); writes++; assert.ok(bytes.buffer.byteLength <= 65536);
        try { await Promise.resolve(); return await writer.write(bytes, options); } finally { outstanding -= bytes.length; }
      } } };
    };
    const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const carrier = createCommandArguments(["in.pdf", "out.pdf", ...(linearize ? ["--linearize"] : [])]);
  const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write() {} }, stderr: { async write() {} } });
  assert.equal(result.exitCode, 0); assert.ok(writes > 0); assert.ok(peak <= 65536); assert.equal(PdfDocument.load(await fs.readFile("/out.pdf")).pageCount, count); assert.deepEqual(await fs.readdir("/scratch"), []);
});

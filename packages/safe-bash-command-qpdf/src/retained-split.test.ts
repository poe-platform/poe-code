import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosStream, cosString, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["single", "group", "padded", "escaped", "stdin", "encrypted", "rotate", "selection", "collision", "empty", "dash", "large-group", "discard-unused", "fixture", "fixture-rotate"]) it(`${mode === "selection" ? "preserves compatibility for" : "streams"} ${mode} split pages with exact bytes`, async () => {
  const doc = PdfDocument.create(); for (let index = 0; index < 5; index++) doc.addPage([100 + index * 10, 200]).drawText(`Page ${index + 1}`, { x: 10, y: 20 });
  doc.setTitle("Title"); doc.setAuthor("Author"); doc.setSubject("Subject"); doc.setKeywords("Keywords");
  dictSet(doc.cos.resolveDict(doc.cos.infoRef)!, "Creator", cosString("Not copied"));
  if (mode === "discard-unused") doc.cos.allocateObject(cosStream(new Uint8Array(1048576).fill(65), { compress: false }));
  const input = mode.startsWith("fixture") ? new Uint8Array(readFileSync(new URL("../../pdf-ast/src/fixtures/qpdf-shared-images.pdf", import.meta.url))) : doc.save(mode === "encrypted" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : {});
  const name = mode === "stdin" ? "-" : mode === "collision" ? "out-2.pdf" : "in.pdf";
  const target = mode === "padded" ? "out-%03d.pdf" : mode === "escaped" ? "out-%%-%d-%d.pdf" : mode === "collision" ? "out-%d.pdf" : mode === "dash" ? "-" : "out.pdf";
  const args = [...(mode === "encrypted" ? ["--password=reader"] : []), ...(mode === "empty" ? ["--empty"] : [name]),
    `--split-pages=${mode === "group" || mode.startsWith("fixture") ? 2 : mode === "large-group" ? 100000000 : 1}`, ...((mode === "rotate" || mode === "fixture-rotate") ? ["--rotate=+90:1-z"] : []), ...(mode === "selection" ? ["--pages", ".", "5-1", "--"] : []), target];
  const files = new Map([[name, input]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); if (name !== "-") await fs.writeFile(`/${name}`, input);
  const guarded = new Proxy(fs, { get(owner, key) {
    if (mode !== "selection" && (key === "readFile" || key === "writeFile")) return () => { throw new Error("Whole-file split I/O forbidden"); };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
  const result = await createQpdfCommand({ limits: { maxOutputBytes: mode === "discard-unused" ? [...files.values()].filter(bytes => bytes !== input).reduce((sum, bytes) => sum + bytes.length, 0) : Infinity } }).execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* () { for (let offset = 0; offset < input.length; offset += 4096) yield input.subarray(offset, offset + 4096); })(), stdout: { async write() { assert.fail("Unexpected stdout"); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } } });
  assert.equal(result.exitCode, expected.exitCode); assert.equal(Buffer.concat(stderr).toString(), expected.stderr);
  for (const [file, bytes] of files) if (bytes !== input) assert.deepEqual(await fs.readFile(`/${file}`), bytes);
  const expectedNames = [...files.keys()].filter(file => file !== "-");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), [...expectedNames, "scratch"].sort());
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const mode of ["read", "cancel", "budget", "publish"]) it(`preserves split publication and cleanup during ${mode} failure`, async () => {
  const doc = PdfDocument.create(); doc.addPage([100, 200]); doc.addPage([300, 400]); doc.cos.allocateObject(cosStream(new Uint8Array(131073).fill(65), { compress: false })); const input = doc.save();
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const old = new Uint8Array([9]); await fs.writeFile("/out-1.pdf", old); await fs.writeFile("/out-2.pdf", old);
  const args = ["in.pdf", "--split-pages", "out.pdf"], files = new Map([["in.pdf", input]]); await runQpdfCli(args, files);
  const controller = new AbortController(), reason = new Error("injected split failure"); let reads = 0, closes = 0, published = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file split I/O forbidden"); };
    if (key === "openReadFile") return async (...params: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...params); if (params[0] !== "/in.pdf") return handle;
      return { ...handle, async read(...range: Parameters<typeof handle.read>) {
        reads++; if (reads === 2 && mode === "read") throw reason; if (reads === 2 && mode === "cancel") controller.abort(reason);
        return handle.read(...range);
      }, async close() { closes++; await handle.close(); } };
    };
    if (key === "publishStagedFile") return async (...params: Parameters<NonNullable<typeof fs.publishStagedFile>>) => {
      published++; if (mode === "publish" && published === 2) throw Object.assign(new Error("missing destination"), { code: "ENOENT" });
      return fs.publishStagedFile!(...params);
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(args), stderr: Uint8Array[] = [];
  const run = async () => createQpdfCommand({ limits: { maxOutputBytes: mode === "budget" ? files.get("out-1.pdf")!.length + 1 : Infinity } }).execute({
    command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write() { assert.fail("Unexpected stdout"); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } },
  });
  if (mode === "publish") { assert.equal((await run()).exitCode, 2); assert.equal(Buffer.concat(stderr).toString(), "qpdf: open out-2.pdf: No such file or directory\n"); }
  else await assert.rejects(run, error => mode === "budget" ? error instanceof Error && error.message === "Output byte limit exceeded" : error === reason);
  assert.deepEqual(await fs.readFile("/out-1.pdf"), mode === "publish" ? files.get("out-1.pdf") : old);
  assert.deepEqual(await fs.readFile("/out-2.pdf"), old); assert.equal(closes, 1); assert.equal(published, mode === "publish" ? 2 : 0);
  assert.deepEqual(await fs.readdir("/scratch"), []); assert.equal((await fs.readdir("/")).some(entry => entry.name.startsWith(".pdf-")), false);
});

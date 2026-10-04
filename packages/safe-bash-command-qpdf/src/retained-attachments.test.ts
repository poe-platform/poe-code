import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, cosString, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["list", "key", "filename", "missing", "encrypted", "stdin", "empty", "late-error", "deep", "wide"]) it(`streams retained attachment ${mode} with compatibility semantics`, async () => {
  const doc = PdfDocument.create(), page = doc.addPage([100, 200]);
  function spec(filename: string, value: number, invalid = false) {
    const stream = cosStream(new Uint8Array(131073).fill(value), { compress: false });
    if (invalid) dictSet(stream.dict, "Filter", cosName("UnsupportedAttachmentFilter"));
    const ref = doc.cos.allocateObject(stream);
    return doc.cos.allocateObject(cosDict({ Type: cosName("Filespec"), UF: cosString(filename), EF: cosDict({ Unix: ref }) }));
  }
  const first = spec("same.bin", 201), second = spec("same.bin", 202), associated = spec("associated.bin", 203), annotated = spec("annotation.bin", 204), ignored = spec("ignored.bin", 205);
  const tree = cosDict({ Names: cosArray([cosString("one"), cosDict({}), cosString("one"), first, cosString("one"), second, cosNumber(9), second, cosString("two"), second]) });
  const treeRef = doc.cos.allocateObject(tree); dictSet(tree, "Kids", cosArray([treeRef]));
  const root = doc.cos.resolveDict(doc.cos.rootRef)!;
  dictSet(root, "Names", cosDict({ EmbeddedFiles: treeRef })); dictSet(root, "AF", cosArray([associated]));
  dictSet(page.dict, "AF", cosArray([ignored]));
  dictSet(page.dict, "Annots", cosArray([cosDict({ Subtype: cosName("FileAttachment"), FS: annotated })]));
  if (mode === "deep") {
    let child = treeRef;
    for (let index = 0; index < 140; index++) child = doc.cos.allocateObject(cosDict({ Kids: cosArray([child]) }));
    dictSet(root, "Names", cosDict({ EmbeddedFiles: child }));
  }
  if (mode === "wide") dictSet(tree, "Kids", cosArray(Array.from({ length: 140 }, (_, index) => doc.cos.allocateObject(cosDict({ Names: cosArray([cosString(`key-${index}`), first]) })))));
  if (mode === "late-error") dictSet(root, "AF", cosArray([spec("broken.bin", 1, true)]));
  const input = doc.save(mode === "encrypted" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : {});
  const name = mode === "stdin" ? "-" : "in.pdf";
  const args = [...(mode === "encrypted" ? ["--password=reader"] : []), ...(mode === "empty" ? ["--empty"] : [name]),
    mode === "key" || mode === "late-error" ? "--show-attachment=one" : mode === "filename" ? "--show-attachment=same.bin" : mode === "missing" ? "--show-attachment=absent" : "--list-attachments"];
  const expected = await runQpdfCli(args, new Map([[name, input]])).then(result => ({ result }), error => ({ error: error as Error }));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file attachment I/O forbidden"); };
    if (key === "openReadFile") return async (...params: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...params); return { ...handle, async read(offset: number, length: number, options?: Parameters<typeof handle.read>[2]) {
        assert.ok(length <= 65536); return handle.read(offset, length, options);
      } };
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
  const run = async () => createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* () { for (let offset = 0; offset < input.length; offset += 4096) yield input.subarray(offset, offset + 4096); })(),
    stdout: { async write(bytes: Uint8Array) { assert.ok(bytes.buffer.byteLength <= 65536); stdout.push(bytes.slice()); await Promise.resolve(); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } } });
  if ("error" in expected) { await assert.rejects(run, error => error instanceof Error && error.message === expected.error.message); assert.equal(stdout.length, 0); }
  else { const result = await run(); assert.equal(result.exitCode, expected.result.exitCode); assert.equal(Buffer.concat(stderr).toString(), expected.result.stderr);
    assert.deepEqual(Buffer.concat(stdout), Buffer.from(expected.result.stdoutBytes ?? new TextEncoder().encode(expected.result.stdout))); }
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const mode of ["read", "cancel", "output-limit", "sink"]) it(`cleans up attachment storage after ${mode} failure`, async () => {
  const doc = PdfDocument.create(); doc.addPage([100, 100]);
  const payload = doc.cos.allocateObject(cosStream(new Uint8Array(262145).fill(211), { compress: false }));
  const spec = cosDict({ F: cosString("data.bin"), EF: cosDict({ F: payload }) });
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AF", cosArray([spec]));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", doc.save());
  const controller = new AbortController(), reason = new Error("injected attachment failure"); let reads = 0, opens = 0, closes = 0, writes = 0;
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file attachment I/O forbidden"); };
    if (key === "openReadFile") return async (...params: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...params); if (params[0] !== "/in.pdf") return handle;
      opens++; return { ...handle, async read(...range: Parameters<typeof handle.read>) {
        reads++; if (reads === 2 && mode === "read") throw reason; if (reads === 2 && mode === "cancel") controller.abort(reason);
        return handle.read(...range);
      }, async close() { closes++; await handle.close(); } };
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const args = ["in.pdf", "--show-attachment=data.bin"], carrier = createCommandArguments(args);
  await assert.rejects(async () => createQpdfCommand({ limits: { maxOutputBytes: mode === "output-limit" ? 16 : Infinity } }).execute({
    command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write() { writes++; if (mode === "sink") throw reason; } },
    stderr: { async write() { assert.fail("Unexpected diagnostic"); } },
  }), error => mode === "output-limit" ? error instanceof Error && error.message.includes("limit") : error === reason);
  assert.equal(opens, 1); assert.equal(closes, 1); assert.equal(writes, mode === "sink" ? 1 : 0); assert.deepEqual(await fs.readdir("/scratch"), []);
});

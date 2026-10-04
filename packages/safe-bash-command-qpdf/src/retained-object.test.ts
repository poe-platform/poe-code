import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosBool, cosDict, cosHexString, cosName, cosNull, cosNumber, cosRef, cosStream, dictGet, dictSet, serializeCosDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["plain", "encrypted", "compressed", "missing", "invalid", "generation", "inline", "unicode", "wide"]) for (const flag of [undefined, "--raw-stream-data", "--filtered-stream-data"]) {
  it(`streams ${mode} object inspection (${flag ?? "display"}) with exact bytes`, async () => {
    const doc = PdfDocument.create(); doc.addPage();
    const bytes = Uint8Array.from({ length: 131072 }, (_, i) => i % 251);
    const value = mode === "compressed" ? cosArray([cosNull(), cosBool(true), cosNumber(-0.5), cosName("Odd Name"), cosRef(1), cosDict({ Empty: cosArray([]) })]) : cosStream(bytes);
    const ref = doc.cos.allocateObject(value); let number = ref.objectNumber;
    if (mode === "wide") doc.cos.objects.set(number, { objectNumber: number, generationNumber: 0, value: cosArray(Array.from({ length: 8192 }, (_, index) => cosNumber(index))) });
    if (mode === "unicode") {
      const text = "a".repeat(4095) + "😀end", utf16 = new Uint8Array(2 + text.length * 2); utf16.set([254, 255]); const view = new DataView(utf16.buffer); for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i));
      doc.cos.objects.set(number, { objectNumber: number, generationNumber: 0, value: cosHexString(utf16) });
    }
    if (mode === "generation") doc.cos.objects.set(number, { ...doc.cos.objects.get(number)!, generationNumber: 7 });
    let input = doc.save(mode === "encrypted" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : mode === "compressed" ? { objectStreams: "generate" } : {});
    if (mode === "inline") {
      const root = doc.cos.resolveDict(dictGet(doc.cos.resolveDict(doc.cos.rootRef)!, "Pages"))!;
      dictSet(root, "Kids", cosArray([cosDict({ Type: cosName("Page"), MediaBox: cosArray([0, 0, 100, 200].map(value => cosNumber(value))) })]));
      input = serializeCosDocument({ objects: [...doc.cos.objects.values()], rootRef: doc.cos.rootRef, infoRef: doc.cos.infoRef });
      number = PdfDocument.load(input).getPage(0).ref.objectNumber;
    }
    if (mode === "missing") number = 999;
    if (mode === "invalid") number = NaN;
    const args = [`--show-object=${number},99`, ...(flag ? [flag] : []), ...(mode === "encrypted" ? ["--password=reader"] : []), "in.pdf"], expected = await runQpdfCli(args, new Map([["in.pdf", input]]));
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
      if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file I/O forbidden"); };
      const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
    } });
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], carrier = createCommandArguments(args);
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
      stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { assert.ok(bytes.buffer.byteLength <= 65536); stdout.push(bytes.slice()); await Promise.resolve(); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } } });
    assert.equal(result.exitCode, expected.exitCode); assert.deepEqual(new Uint8Array(Buffer.concat(stdout)), expected.stdoutBytes ?? new TextEncoder().encode(expected.stdout)); assert.equal(Buffer.concat(stderr).toString(), expected.stderr); assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}

for (const mode of ["budget", "staging", "stdout", "cancel"]) it(`releases object-output backing after ${mode} failure`, async () => {
  const doc = PdfDocument.create(); doc.addPage(); const object = doc.cos.allocateObject(cosStream(new Uint8Array(131072).fill(65), { compress: true }));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", doc.save());
  const reason = new Error("injected object-output failure"), controller = new AbortController(); let writes = 0;
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args); if (mode !== "staging" || args[1] !== "bytes") return staged;
      return { ...staged, writer: { ...staged.writer!, write: async () => { throw reason; } } };
    };
    const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const carrier = createCommandArguments([`--show-object=${object.objectNumber}`, "--filtered-stream-data", "in.pdf"]);
  const context = { command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write() { writes++; if (mode === "stdout") throw reason; if (mode === "cancel") controller.abort(reason); } }, stderr: { async write() {} } };
  await assert.rejects(async () => createQpdfCommand({ limits: mode === "budget" ? { maxOutputBytes: 1 } : {} }).execute(context), error => mode === "budget" ? error instanceof Error && error.message.toLowerCase().includes("limit") : error === reason);
  assert.equal(writes, mode === "budget" || mode === "staging" ? 0 : 1); assert.deepEqual(await fs.readdir("/scratch"), []);
});

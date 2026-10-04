import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosDict, cosName, dictDelete, dictGet, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["direct", "skip", "large", "groups", "collision", "inherited", "shared", "split", "selection", "linearize", "uncompress", "prune", "flatten", "filter", "slow", "qdf", "normalize", "normalize-off", "uncompress-skip", "qdf-split", "shared-linearize", "length-normalize"]) it(`externalizes ${mode} inline images through caller storage`, async () => {
  const document = PdfDocument.create(), page = document.addPage(), other = document.addPage();
  const size = mode === "large" ? 65537 : 6;
  const prefix = mode === "filter" ? "BI /W 2 /H 1 /BPC 8 /CS /G /F /AHx ID " : `BI /W ${size} /H 1 /BPC 8 /CS /G ID `;
  const image = Buffer.concat([Buffer.from(mode === "length-normalize" ? prefix.replace("/CS", "/Length 999 /CS") : prefix), mode === "filter" ? Buffer.from("0102>") : Buffer.alloc(size, 130), Buffer.from(" EI")]);
  page.setRawContentStream(mode === "groups" ? Buffer.concat([Buffer.from("q /Span BMC BT /F1 12 Tf [(A) 1 (B)] TJ ET\n"), image, Buffer.from("\nEMC Q")]) : image);
  if (mode === "flatten") page.setRotation(90);
  const resources = cosDict({ XObject: cosDict({ ImExt1: document.cos.allocateObject(cosDict({ Type: cosName("Example") })) }) });
  if (mode === "collision") dictSet(page.dict, "Resources", resources);
  if (mode === "inherited") { const tree = document.cos.resolveDict(dictGet(document.cos.resolveDict(document.cos.rootRef)!, "Pages"))!; dictSet(tree, "Resources", resources); dictDelete(page.dict, "Resources"); }
  if ((mode === "shared" || mode === "shared-linearize")) dictSet(other.dict, "Contents", dictGet(page.dict, "Contents")!);
  const input = document.save(), args = ["in.pdf", "out.pdf", "--externalize-inline-images", `--ii-min-bytes=${(mode === "skip" || mode === "uncompress-skip") ? 1024 : 1}`,
    ...((mode === "split" || mode === "qdf-split") ? ["--split-pages"] : []), ...(mode === "selection" ? ["--pages", ".", "1,1", "--"] : []),
    ...((mode === "linearize" || mode === "shared-linearize") ? ["--linearize"] : []), ...(["uncompress", "uncompress-skip", "normalize-off"].includes(mode) ? ["--stream-data=uncompress"] : []),
    ...(["qdf", "qdf-split"].includes(mode) ? ["--qdf"] : []), ...(["normalize", "length-normalize"].includes(mode) ? ["--normalize-content=y"] : []), ...(mode === "normalize-off" ? ["--normalize-content=n"] : []),
    ...(mode === "prune" ? ["--remove-unreferenced-resources=yes"] : []), ...(mode === "flatten" ? ["--flatten-rotation"] : [])];
  const files = new Map([["in.pdf", input]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  let peak = 0, pending = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file inline-image I/O"); };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        pending += bytes.length; peak = Math.max(peak, pending); assert.ok(bytes.buffer.byteLength <= 65536);
        try { if (mode === "slow") await new Promise(resolve => setTimeout(resolve, 1)); return await writer.write(bytes, options); } finally { pending -= bytes.length; }
      } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
  const actual = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
  assert.equal(actual.exitCode, expected.exitCode); assert.equal(Buffer.concat(errors).toString(), expected.stderr);
  for (const [name, bytes] of files) if (name !== "in.pdf") assert.deepEqual(await fs.readFile(`/${name}`), bytes);
  assert.equal(pending, 0); assert.ok(peak <= 65536); assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const mode of ["write", "cancel"]) it(`cleans decoded inline-image staging after ${mode} failure`, async () => {
  const document = PdfDocument.create(), page = document.addPage();
  page.setRawContentStream(Buffer.concat([Buffer.from("BI /W 131073 /H 1 /BPC 8 /CS /G ID "), Buffer.alloc(131073, 130), Buffer.from(" EI")]));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", document.save());
  const original = Uint8Array.of(1, 2, 3); await fs.writeFile("/out.pdf", original);
  const controller = new AbortController(), reason = new Error("inline-image staging failure"); let injected = false, opens = 0, closes = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        if (!injected && bytes.length > 32 && bytes.every(byte => byte === 130)) { injected = true; if (mode === "cancel") controller.abort(reason); else throw reason; }
        return writer.write(bytes, options);
      } } };
    };
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...args); opens++;
      return { ...handle, async close() { closes++; await handle.close(); } };
    };
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file inline-image I/O"); };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(["in.pdf", "out.pdf", "--externalize-inline-images"]);
  await assert.rejects(async () => createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: controller.signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } }), error => error === reason);
  assert.equal(injected, true); assert.equal(opens, closes); assert.deepEqual(await fs.readFile("/out.pdf"), original); assert.deepEqual(await fs.readdir("/scratch"), []);
});

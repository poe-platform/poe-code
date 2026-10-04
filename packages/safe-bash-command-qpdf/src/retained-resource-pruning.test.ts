import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosStream, dictDelete, dictGet, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["direct", "indirect", "inherited", "transitive", "annotations", "escaped", "long", "split", "selection", "linearize", "slow", "boundary", "hex-tail", "pattern", "shared", "auto", "unsupported", "flatten", "resource-self", "page-self"]) it(`prunes ${mode} resources through caller storage`, async () => {
  const document = PdfDocument.create(), page = document.addPage(), other = document.addPage();
  const font = document.cos.allocateObject(cosDict({ Type: cosName("Font"), BaseFont: cosName("Helvetica"), Subtype: cosName("Type1") }));
  const resources = cosDict({ Font: cosDict({ Used: font, Unused: font, Hidden: font }), XObject: cosDict({ Form: document.cos.allocateObject(cosStream(new TextEncoder().encode("/Hidden 10 Tf"))) }) });
  if (mode === "indirect") for (const entry of resources.entries) dictSet(resources, entry.key.decoded, document.cos.allocateObject(entry.value));
  dictSet(page.dict, "Resources", mode === "indirect" ? document.cos.allocateObject(resources) : resources);
  if (mode === "inherited") { const root = document.cos.resolveDict(document.cos.rootRef)!, tree = document.cos.resolveDict(dictGet(root, "Pages"))!; dictSet(tree, "Resources", resources); dictDelete(page.dict, "Resources"); }
  page.setRawContentStream(mode === "escaped" ? "/U#73ed 10 Tf % /Unused\n" : mode === "long" ? "/" + "x".repeat(1024) + " /Used 10 Tf" : mode === "transitive" ? "/Form Do" : "/Used 10 Tf");
  if (mode === "flatten") page.setRotation(90);
  if (mode === "annotations") dictSet(page.dict, "Annots", cosArray([cosDict({ AP: cosDict({ N: document.cos.allocateObject(cosStream(new TextEncoder().encode("/Hidden 10 Tf"))) }) })]));
  if (mode === "boundary") page.setRawContentStream(" ".repeat(65534) + "/U#73ed 10 Tf");
  if (mode === "hex-tail") { const fonts = document.cos.resolveDict(dictGet(resources, "Font"))!; dictSet(fonts, "Name#7", font); page.setRawContentStream("/Name#7"); }
  if (mode === "pattern") { dictSet(resources, "Pattern", cosDict({ P: document.cos.allocateObject(cosStream(new TextEncoder().encode("/Form Do"))) })); page.setRawContentStream("/P scn"); }
  if (mode === "shared") { const ref = document.cos.allocateObject(resources); dictSet(page.dict, "Resources", ref); dictSet(other.dict, "Resources", ref); }
  if (mode === "resource-self") { const ref = document.cos.allocateObject(resources); dictSet(resources, "Font", ref); dictSet(resources, "Used", font); dictSet(page.dict, "Resources", ref); }
  if (mode === "page-self") {
    const root = document.cos.resolveDict(document.cos.rootRef)!, tree = document.cos.resolveDict(dictGet(root, "Pages"))!;
    const kids = document.cos.resolveArray(dictGet(tree, "Kids"))!;
    dictSet(page.dict, "Resources", kids.items[0]!); dictSet(page.dict, "Font", dictGet(resources, "Font")!);
  }
  other.setRawContentStream(mode === "shared" ? "/Hidden 10 Tf" : "");
  if (mode === "unsupported") { const stream = document.cos.resolve(dictGet(page.dict, "Contents")); if (stream?.kind === "stream") dictSet(stream.dict, "Filter", cosName("Unsupported")); }
  const input = document.save(), args = ["in.pdf", "out.pdf", mode === "auto" ? "--remove-unreferenced-resources=auto" : "--remove-unreferenced-resources=yes", ...(mode === "flatten" ? ["--flatten-rotation"] : []), ...(mode === "linearize" ? ["--linearize"] : []), ...(mode === "split" ? ["--split-pages"] : []), ...(mode === "selection" ? ["--pages", ".", "1,1", "--"] : [])];
  let expectedError: Error | undefined, actualError: Error | undefined;
  const files = new Map([["in.pdf", input]]), expected = await runQpdfCli(args, files).catch((error: Error) => { expectedError = error; return { exitCode: 2, stdout: "", stderr: "" }; });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  let outstanding = 0, peak = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        outstanding += bytes.byteLength; peak = Math.max(peak, outstanding); assert.ok(bytes.buffer.byteLength <= 65536);
        try { if (mode === "slow") await new Promise(resolve => setTimeout(resolve, 1)); return await writer.write(bytes, options); }
        finally { outstanding -= bytes.byteLength; }
      } } };
    };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args);
      return new Proxy(handle, { get(target, property) {
        if (property === "write") return async (...args: Parameters<typeof handle.write>) => {
          const size = args[0].byteLength; outstanding += size; peak = Math.max(peak, outstanding);
          try { if (mode === "slow") await new Promise(resolve => setTimeout(resolve, 1)); return await handle.write(...args); }
          finally { outstanding -= size; }
        };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
    }; if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file pruning I/O"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
  const actual = await Promise.resolve(createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes.slice()); } } })).catch((error: Error) => { actualError = error; return { exitCode: 2 }; });
  assert.equal(actualError?.message, expectedError?.message);
  assert.equal(actual.exitCode, expected.exitCode); assert.equal(Buffer.concat(errors).toString(), expected.stderr);
  for (const [name, bytes] of files) if (name !== "in.pdf") assert.deepEqual(await fs.readFile(`/${name}`), bytes);
  assert.deepEqual(await fs.readdir("/scratch"), []);
  assert.equal(outstanding, 0); assert.ok(peak <= 65536);
});

for (const mode of ["write", "cancel"]) it(`cleans resource membership storage after ${mode} failure`, async () => {
  const doc = PdfDocument.create(), page = doc.addPage();
  page.setRawContentStream("/" + "A".repeat(128));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", doc.save());
  const original = new Uint8Array([1, 2, 3]); await fs.writeFile("/out.pdf", original);
  const controller = new AbortController(), reason = new Error("resource staging failure");
  let injected = false, opened = 0, closed = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        if (!injected && bytes.byteLength === 2048) {
          injected = true;
          if (mode === "cancel") controller.abort(reason); else throw reason;
        }
        return writer.write(bytes, options);
      } } };
    };
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...args); opened++;
      return { ...handle, async close() { closed++; await handle.close(); } };
    };
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file pruning I/O"); };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(["in.pdf", "out.pdf", "--remove-unreferenced-resources=yes"]);
  await assert.rejects(async () => createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier,
    cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal, stdin: (async function* () {})(),
    stdout: { async write() { assert.fail("Unexpected output"); } }, stderr: { async write() { assert.fail("Unexpected diagnostic"); } },
  }), error => error === reason);
  assert.equal(injected, true); assert.equal(opened, closed);
  assert.deepEqual(await fs.readFile("/out.pdf"), original); assert.deepEqual(await fs.readdir("/scratch"), []);
});

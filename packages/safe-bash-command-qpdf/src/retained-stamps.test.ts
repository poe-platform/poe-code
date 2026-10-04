import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosRef, cosStream, dictDelete, dictGet, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["overlay", "underlay", "repeat", "empty-from", "empty-repeat", "duplicates", "multiple", "scale", "rotate90", "rotate180", "rotate270", "inherited", "indirect", "generation", "xobject", "xobject-qdf", "cycle", "shared", "large", "qdf", "normalize", "split", "selection", "linearize", "flatten", "prune", "stdin", "missing", "encrypted", "encrypted-qdf"]) it(`streams ${mode} stamps with exact buffered output`, async () => {
  const base = PdfDocument.create(), stamp = PdfDocument.create();
  for (let i = 0; i < 3; i++) {
    const page = base.addPage([300, 400]); page.drawText(`Base ${i}`, { x: 20, y: 30, size: 12 });
    const other = stamp.addPage(mode === "scale" ? [200, 200] : [300, 400]); other.drawText(`Stamp ${i}`, { x: 30, y: 60, size: 18 });
    if (mode.startsWith("rotate")) page.setRotation(Number(mode.slice(6)) as 90 | 180 | 270);
    if (mode === "flatten") page.setRotation(90);
    if (mode === "large") other.setRawContentStream(Buffer.concat([Buffer.from("%"), Buffer.alloc(140000, 65), Buffer.from("\n/F1 12 Tf")]));
  }
  if (mode === "shared") dictSet(base.getPage(1).dict, "Contents", dictGet(base.getPage(0).dict, "Contents")!);
  if (mode === "indirect") for (const document of [base, stamp]) {
    const page = document.getPage(0), resource = page.getResourcesDict();
    dictSet(resource, "Font", document.cos.allocateObject(document.cos.resolve(dictGet(resource, "Font"))!));
    dictSet(page.dict, "Resources", document.cos.allocateObject(resource));
  }
  if (mode === "inherited") for (const document of [base, stamp]) {
    const tree = document.cos.resolveDict(dictGet(document.cos.resolveDict(document.cos.rootRef)!, "Pages"))!;
    dictSet(tree, "Resources", document.getPage(0).getResourcesDict()); dictDelete(document.getPage(0).dict, "Resources");
  }
  if (mode.startsWith("xobject")) {
    const form = stamp.cos.allocateObject(cosStream(Buffer.from("0 0 30 40 re f"), { compress: true,
      dict: cosDict({ Type: cosName("XObject"), Subtype: cosName("Form"), BBox: cosArray([0, 0, 30, 40].map(value => cosNumber(value))) }) }));
    dictSet(stamp.getPage(0).getResourcesDict(), "XObject", cosDict({ Fm: form }));
    stamp.getPage(0).setRawContentStream(Buffer.from("q /Fm Do Q"));
  }
  if (mode === "generation") {
    const fonts = stamp.cos.resolveDict(dictGet(stamp.getPage(0).getResourcesDict(), "Font"))!;
    const font = dictGet(fonts, "F1")!; assert.equal(font.kind, "ref");
    if (font.kind === "ref") dictSet(fonts, "F1", cosRef(font.objectNumber, 5));
  }
  if (mode === "cycle") {
    const ref = stamp.cos.allocateObject(cosDict({ Type: cosName("Example") }));
    dictSet(stamp.cos.resolveDict(ref)!, "Self", ref);
    dictSet(stamp.getPage(0).getResourcesDict(), "Properties", cosDict({ Cycle: ref }));
  }
  const input = base.save(), stampBytes = stamp.save(mode.startsWith("encrypted") ? { encrypt: { userPassword: "secret", ownerPassword: "owner" } } : {});
  const stampFile = mode === "stdin" ? "-" : mode === "missing" ? "missing.pdf" : "stamp.pdf";
  const args = ["in.pdf", "out.pdf", mode === "underlay" ? "--underlay" : "--overlay", stampFile,
    ...(mode === "repeat" ? ["--from=2", "--repeat=3,1"] : []), ...(mode === "empty-from" ? ["--from=1,x1"] : []),
    ...(mode === "empty-repeat" ? ["--from=1", "--repeat=1,x1"] : []), ...(mode === "duplicates" ? ["--to=1,1,2", "--from=3,2,1"] : []),
    ...(mode.startsWith("encrypted") ? ["--password=secret"] : []), "--",
    ...(mode === "multiple" ? ["--underlay", "stamp.pdf", "--"] : []), ...((mode === "qdf" || mode.endsWith("-qdf")) ? ["--qdf"] : []),
    ...(mode === "normalize" ? ["--normalize-content=y"] : []), ...(mode === "split" ? ["--split-pages"] : []),
    ...(mode === "selection" ? ["--pages", ".", "3,1,1", "--"] : []), ...(mode === "linearize" ? ["--linearize"] : []),
    ...(mode === "flatten" ? ["--flatten-rotation"] : []), ...(mode === "prune" ? ["--remove-unreferenced-resources=yes"] : [])];
  const files = new Map([["in.pdf", input], [mode === "stdin" ? "-" : "stamp.pdf", stampBytes]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/stamp.pdf", stampBytes);
  let pending = 0, peak = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file stamp I/O forbidden"); };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        pending += bytes.length; peak = Math.max(peak, pending); assert.ok(bytes.buffer.byteLength <= 65536);
        try { await Promise.resolve(); return await writer.write(bytes, options); } finally { pending -= bytes.length; }
      } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
  const actual = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: new AbortController().signal, stdin: (async function* () { if (mode === "stdin") yield stampBytes; })(), stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
  assert.equal(actual.exitCode, expected.exitCode); assert.equal(Buffer.concat(errors).toString(), expected.stderr);
  for (const [name, bytes] of files) if (name !== "in.pdf" && name !== "stamp.pdf" && name !== "-") assert.deepEqual(await fs.readFile(`/${name}`), bytes);
  assert.equal(pending, 0); assert.ok(peak <= 65536); assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const mode of ["write", "cancel"]) it(`cleans stamp staging and preserves the destination after ${mode}`, async () => {
  const base = PdfDocument.create(), stamp = PdfDocument.create(); base.addPage();
  stamp.addPage().setRawContentStream(Buffer.concat([Buffer.from("%"), Buffer.alloc(140000, 65), Buffer.from("\n")]));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", base.save()); await fs.writeFile("/stamp.pdf", stamp.save());
  const original = Uint8Array.of(1, 2, 3); await fs.writeFile("/out.pdf", original);
  const controller = new AbortController(), reason = new Error("stamp staging failed"); let injected = false, opens = 0, closes = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        if (!injected && bytes.length > 32 && bytes.every(byte => byte === 65)) { injected = true; if (mode === "cancel") controller.abort(reason); else throw reason; }
        return writer.write(bytes, options);
      } } };
    };
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...args); opens++;
      return { ...handle, async close() { closes++; await handle.close(); } };
    };
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file stamp I/O forbidden"); };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(["in.pdf", "out.pdf", "--overlay", "stamp.pdf", "--"]);
  await assert.rejects(async () => createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: controller.signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } }), error => error === reason);
  assert.equal(injected, true); assert.equal(opens, closes); assert.deepEqual(await fs.readFile("/out.pdf"), original); assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const flags of [["--from=1,x1", "--to=99"], ["--repeat=99"], ["--from=99"], ["--password=wrong"]]) it(`preserves eager stamp validation: ${flags.join(" ")}`, async () => {
  const base = PdfDocument.create(), stamp = PdfDocument.create(); base.addPage(); stamp.addPage();
  const encrypted = flags[0] === "--password=wrong";
  const input = base.save(), other = stamp.save(encrypted ? { encrypt: { userPassword: "secret", ownerPassword: "owner" } } : {});
  const args = ["in.pdf", "out.pdf", "--overlay", "stamp.pdf", ...flags, "--"];
  let expected: unknown;
  try { await runQpdfCli(args, new Map([["in.pdf", input], ["stamp.pdf", other]])); } catch (error) { expected = error; }
  assert.ok(expected instanceof Error);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/stamp.pdf", other);
  const original = Uint8Array.of(1); await fs.writeFile("/out.pdf", original);
  const carrier = createCommandArguments(args);
  await assert.rejects(async () => createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } }), { message: expected.message });
  assert.deepEqual(await fs.readFile("/out.pdf"), original); assert.deepEqual(await fs.readdir("/scratch"), []);
});

it("evicts inactive stamp input ranges before reusing the retained identity", async () => {
  const base = PdfDocument.create(), stamp = PdfDocument.create(); base.addPage(); stamp.addPage().drawText("Stamp", { x: 30, y: 30, size: 12 });
  async function readsFor(repetitions: number) {
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", base.save()); await fs.writeFile("/stamp.pdf", stamp.save());
    let reads = 0, acquisitions = 0;
    const guarded = new Proxy(fs, { get(owner, key) {
      if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
        const handle = await fs.openReadFile!(...args); if (args[0] !== "/stamp.pdf") return handle; acquisitions++;
        return { ...handle, async read(...readArgs: Parameters<typeof handle.read>) { reads++; return handle.read(...readArgs); } };
      };
      const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
    } });
    const args = ["in.pdf", "out.pdf", ...Array.from({ length: repetitions }, () => ["--overlay", "stamp.pdf", "--"]).flat()], carrier = createCommandArguments(args);
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
      signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
    assert.equal(result.exitCode, 0); assert.equal(acquisitions, 1); assert.deepEqual(await fs.readdir("/scratch"), []);
    return reads;
  }
  assert.ok(await readsFor(2) > await readsFor(1));
});

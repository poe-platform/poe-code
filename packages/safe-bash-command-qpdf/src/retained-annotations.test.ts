import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, cosString, dictGet, dictSet, dictDelete } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["appearance", "text", "empty-ap", "state", "state-first", "matrix", "bbox", "flags", "print", "screen", "survivors", "mixed-survivors", "indirect", "inherited", "shared", "same-font", "new-font", "font-collision", "collisions", "large", "large-text", "mixed", "text-twice", "widget", "button", "off", "unicode", "empty-content", "malformed-content", "qdf", "normalize", "encrypted", "encrypted-keep", "overlay", "selection", "split", "linearize", "flatten", "prune", "inline"]) it(`flattens ${mode} annotations through caller backing with exact output`, async () => {
  const doc = PdfDocument.create(), page = doc.addPage([300, 400]); page.drawText("Base", { x: 20, y: 300, size: 14 });
  if (mode === "empty-content") dictDelete(page.dict, "Contents");
  if (mode === "malformed-content") page.setRawContentStream(Buffer.from("Q q BT (unfinished) Tj"));
  if (mode === "inline") page.setRawContentStream(Buffer.concat([Buffer.from("BI /W 1 /H 1 /BPC 8 /CS /RGB ID "), Uint8Array.of(255, 0, 0), Buffer.from(" EI")]));
  if (mode === "flatten") page.setRotation(90);
  const font = mode === "same-font" ? dictGet(doc.cos.resolveDict(dictGet(page.getResourcesDict(), "Font"))!, "F1")!
    : doc.cos.allocateObject(cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier") }));
  if (mode === "new-font") dictDelete(page.dict, "Resources");
  if (mode === "font-collision") dictSet(page.getResourcesDict(), "Font", cosDict({ F1: font }));
  const res = cosDict({ Font: cosDict({ F1: font }) });
  if (mode === "collisions") {
    dictSet(page.getResourcesDict(), "ColorSpace", cosDict({ F1: cosName("DeviceGray") }));
    dictSet(res, "ColorSpace", cosDict({ F1: cosName("DeviceRGB") }));
    dictSet(doc.cos.resolveDict(dictGet(page.getResourcesDict(), "Font"))!, "F1_qap1", font);
  }
  const data = mode === "empty-ap" ? Buffer.alloc(0) : mode === "large" ? Buffer.concat([Buffer.from("%"), Buffer.alloc(140000, 65), Buffer.from("\n0 0 10 10 re f")]) : Buffer.from("BT /F1 10 Tf 1 0 0 1 0 0 Tm (Appearance) Tj ET");
  const ap = doc.cos.allocateObject(cosStream(data, { compress: true, dict: cosDict({ BBox: cosArray((mode === "bbox" ? [-10, -5, 40, 20] : [0, 0, 100, 25]).map(v => cosNumber(v))), Resources: res,
    ...(mode === "matrix" ? { Matrix: cosArray([0, 1, -1, 0, 25, 0].map(v => cosNumber(v))) } : {}) }) }));
  const textMode = ["text", "text-twice", "new-font", "font-collision", "large-text", "widget", "button", "off", "unicode", "empty-content", "malformed-content", "inline"].includes(mode);
  const annotation = cosDict({ Subtype: cosName(mode === "widget" || mode === "button" ? "Widget" : "Square"), Rect: cosArray([20, 40, 220, 90].map(v => cosNumber(v))), F: cosNumber(4),
    ...(textMode ? {} : { AP: cosDict({ N: mode === "state" || mode === "state-first" ? cosDict({ First: ap, Chosen: ap }) : ap }) }),
    ...(mode === "state" ? { AS: cosName("Chosen") } : {}),
    Contents: cosString(mode === "large-text" ? "A".repeat(70000) : mode === "unicode" ? "Résumé € 😀" : "Fallback") });
  if (mode === "widget") { dictDelete(annotation, "Contents"); dictSet(annotation, "Parent", doc.cos.allocateObject(cosDict({ V: cosString("Field value") }))); }
  if (mode === "button" || mode === "off") { dictDelete(annotation, "Contents"); dictSet(annotation, "V", cosName(mode === "off" ? "Off" : "Yes")); }
  const items = [doc.cos.allocateObject(annotation)];
  if (["flags", "print", "screen"].includes(mode)) for (const flag of [0, 1, 2, 4, 32, 36]) items.push(doc.cos.allocateObject(cosDict({ ...Object.fromEntries(annotation.entries.map(e => [e.key.decoded, e.value])), F: cosNumber(flag) })));
  if (mode === "survivors") for (const subtype of ["Link", "Popup"]) items.push(doc.cos.allocateObject(cosDict({ Subtype: cosName(subtype), F: cosNumber(2) })));
  if (mode === "mixed" || mode === "text-twice") {
    items.push(doc.cos.allocateObject(cosDict({ Subtype: cosName("Text"), Contents: cosString("Second text") })));
    items.push(doc.cos.allocateObject(mode === "mixed" ? annotation : cosDict({ Contents: cosString("Third text") })));
  }
  if (mode === "mixed-survivors") {
    items.length = 0;
    const content = dictGet(page.dict, "Contents")!; assert.equal(content.kind, "ref");
    if (content.kind === "ref") items.push(content);
    items.push(doc.cos.allocateObject(cosDict({ Subtype: cosName("Link") })), doc.cos.allocateObject(cosDict({ Contents: cosString("After survivor") })));
  }
  dictSet(page.dict, "Annots", mode === "indirect" ? doc.cos.allocateObject(cosArray(items)) : cosArray(items));
  if (mode === "inherited") { const tree = doc.cos.resolveDict(dictGet(doc.cos.resolveDict(doc.cos.rootRef)!, "Pages"))!; dictSet(tree, "Resources", page.getResourcesDict()); dictDelete(page.dict, "Resources"); }
  if (mode === "shared") { const other = doc.addPage(); dictSet(other.dict, "Contents", dictGet(page.dict, "Contents")!); dictSet(other.dict, "Annots", dictGet(page.dict, "Annots")!); }
  const input = doc.save(mode.startsWith("encrypted") ? { encrypt: { userPassword: "secret", ownerPassword: "owner" } } : {});
  const args = ["in.pdf", "out.pdf", `--flatten-annotations=${mode === "print" || mode === "screen" ? mode : "all"}`,
    ...(mode === "qdf" ? ["--qdf"] : []), ...(mode === "normalize" ? ["--normalize-content=y"] : []), ...(mode.startsWith("encrypted") ? ["--password=secret", ...(mode === "encrypted" ? ["--decrypt"] : [])] : []),
    ...(mode === "overlay" ? ["--overlay", "in.pdf", "--"] : []), ...(mode === "selection" ? ["--pages", ".", "1,1", "--"] : []),
    ...(mode === "split" ? ["--split-pages"] : []), ...(mode === "linearize" ? ["--linearize"] : []), ...(mode === "flatten" ? ["--flatten-rotation"] : []), ...(mode === "prune" ? ["--remove-unreferenced-resources=yes"] : [])];
  const files = new Map([["in.pdf", input]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  let pending = 0, peak = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file annotation I/O forbidden"); };
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
    signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
  assert.equal(actual.exitCode, expected.exitCode); assert.equal(Buffer.concat(errors).toString(), expected.stderr);
  for (const [name, bytes] of files) if (name !== "in.pdf") assert.deepEqual(await fs.readFile(`/${name}`), bytes);
  assert.equal(pending, 0); assert.ok(peak <= 65536); assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const mode of ["write", "cancel", "output-limit"]) it(`preserves outputs and cleans annotation storage after ${mode}`, async () => {
  const doc = PdfDocument.create(), page = doc.addPage();
  const ap = doc.cos.allocateObject(cosStream(Buffer.concat([Buffer.from("%"), Buffer.alloc(140000, 65), Buffer.from("\n")]), { compress: true }));
  dictSet(page.dict, "Annots", cosArray([doc.cos.allocateObject(cosDict({ AP: cosDict({ N: ap }) }))]));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", doc.save());
  const original = Uint8Array.of(1, 2, 3); await fs.writeFile("/out.pdf", original);
  const controller = new AbortController(), reason = new Error("annotation staging failed"); let injected = false, opens = 0, closes = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        if (mode !== "output-limit" && !injected && bytes.length > 32 && bytes.every(byte => byte === 65)) { injected = true; if (mode === "cancel") controller.abort(reason); else throw reason; }
        return writer.write(bytes, options);
      } } };
    };
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...args); opens++;
      return { ...handle, async close() { closes++; await handle.close(); } };
    };
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file annotation I/O forbidden"); };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(["in.pdf", "out.pdf", "--flatten-annotations"]);
  await assert.rejects(async () => createQpdfCommand(mode === "output-limit" ? { limits: { maxOutputBytes: 10 } } : {}).execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: controller.signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } }), error => mode === "output-limit" ? error instanceof Error && error.message.includes("limit") : error === reason);
  assert.equal(injected, mode !== "output-limit"); assert.equal(opens, closes); assert.deepEqual(await fs.readFile("/out.pdf"), original); assert.deepEqual(await fs.readdir("/scratch"), []);
});

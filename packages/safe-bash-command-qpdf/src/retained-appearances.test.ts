import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosBool, cosDict, cosName, cosNumber, cosString, dictSet, dictDelete } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["text", "multiline", "unicode", "password", "comb", "choice", "button", "direct", "kids", "inherited", "force", "preserve", "large", "many", "flatten", "linearize", "remove", "qdf", "encrypted", "direct-kids", "repeat", "button-force", "button-off", "parent-da", "form-da", "selection", "split", "labels", "overlay", "uncompress", "json", "json-inline"]) it(`generates ${mode} appearances with retained I/O and exact bytes`, async () => {
  const doc = PdfDocument.create(), page = doc.addPage([300, 400]); page.drawText("Form", { x: 20, y: 300 });
  const field = cosDict({ T: cosString("field"), FT: cosName(mode === "choice" ? "Ch" : mode.startsWith("button") ? "Btn" : "Tx"),
    V: mode.startsWith("button") ? cosName(mode === "button-off" ? "Off" : "Yes") : cosString(mode === "large" ? "é".repeat(70000) : mode === "unicode" ? "(é)\\😀" : mode === "multiline" ? "one\r\ntwo\n" : "value"),
    Subtype: cosName("Widget"), Rect: cosArray([20, 40, 220, 90].map(v => cosNumber(v))), DA: cosString("/Cour 9 Tf 0.1 0.2 0.3 rg"),
    Q: cosNumber(2), Ff: cosNumber(mode === "comb" ? 1 << 24 : mode === "password" ? 1 << 13 : 0), MaxLen: cosNumber(8) });
  if (mode === "choice") dictSet(field, "Opt", cosArray([cosArray([cosString("value"), cosString("display")])]));
  if (mode === "force" || mode === "preserve" || mode === "button-force") dictSet(field, "AP", cosDict({ N: cosNumber(0) }));
  if (mode === "inherited") { dictDelete(field, "FT"); dictDelete(field, "Q"); }
  const ref = mode === "direct" ? field : doc.cos.allocateObject(field);
  if (mode === "kids") dictSet(field, "Kids", cosArray([doc.cos.allocateObject(cosDict({ Subtype: cosName("Widget"), Rect: cosArray([10, 10, 100, 40].map(v => cosNumber(v))), Parent: ref }))]));
  if (mode === "direct-kids") dictSet(field, "Kids", cosArray([cosDict({ Subtype: cosName("Widget") }), cosDict({ Subtype: cosName("Widget") })]));
  if (mode === "parent-da") { dictDelete(field, "DA"); dictSet(field, "Parent", doc.cos.allocateObject(cosDict({ DA: cosString("/TiRo 8 Tf 0.5 g") }))); }
  if (mode === "form-da") dictDelete(field, "DA");
  const entries = mode === "inherited" ? [doc.cos.allocateObject(cosDict({ T: cosString("parent"), FT: cosName("Tx"), Q: cosNumber(1), Kids: cosArray([ref]) }))] : [ref];
  if (mode === "repeat") entries.push(ref);
  if (mode === "many") for (let i = 0; i < 300; i++) entries.push(doc.cos.allocateObject(cosDict({ T: cosString(`field${i}`), FT: cosName("Tx"), V: cosString(`value${i}`) })));
  const form = cosDict({ Fields: cosArray(entries), NeedAppearances: cosBool(mode === "force" || mode === "button-force" || mode === "repeat") });
  if (mode === "form-da") dictSet(form, "DA", cosString("/TiBo 0 Tf 0 1 0 rg"));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", mode === "direct" ? form : doc.cos.allocateObject(form)); dictSet(page.dict, "Annots", cosArray([ref]));
  const input = doc.save(mode === "encrypted" ? { encrypt: { userPassword: "secret", ownerPassword: "owner" } } : {});
  const args = ["in.pdf", "out.pdf", "--generate-appearances", ...(mode === "flatten" ? ["--flatten-annotations"] : []), ...(mode === "linearize" ? ["--linearize"] : []),
    ...(mode === "remove" ? ["--remove-acroform"] : []), ...(mode === "qdf" ? ["--qdf"] : []), ...(mode.startsWith("json") ? ["--json", ...(mode === "json-inline" ? ["--externalize-inline-images"] : [])] : []), ...(mode === "selection" ? ["--pages", ".", "1,1", "--"] : []), ...(mode === "split" ? ["--split-pages"] : []),
    ...(mode === "labels" ? ["--set-page-labels=1:D"] : []), ...(mode === "overlay" ? ["--overlay", "in.pdf", "--"] : []), ...(mode === "uncompress" ? ["--stream-data=uncompress"] : []), ...(mode === "encrypted" ? ["--password=secret", "--decrypt"] : [])];
  const files = new Map([["in.pdf", input]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  let pending = 0, peak = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file appearance I/O forbidden"); };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        pending += bytes.length; peak = Math.max(peak, pending); assert.ok(bytes.buffer.byteLength <= 65536);
        try { await Promise.resolve(); return await writer.write(bytes, options); } finally { pending -= bytes.length; }
      } } };
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(args), errors: Uint8Array[] = [], output: Uint8Array[] = [];
  const actual = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes) { output.push(bytes.slice()); } }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
  assert.equal(actual.exitCode, expected.exitCode); assert.equal(Buffer.concat(errors).toString(), expected.stderr); assert.equal(Buffer.concat(output).toString(), expected.stdout);
  for (const [name, bytes] of files) if (name !== "in.pdf") assert.deepEqual(await fs.readFile(`/${name}`), bytes);
  assert.equal(pending, 0); assert.ok(peak <= 65536); assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const mode of ["write", "cancel", "output-limit"]) it(`preserves outputs and cleans appearance storage after ${mode}`, async () => {
  const doc = PdfDocument.create(); doc.addPage();
  const field = doc.cos.allocateObject(cosDict({ T: cosString("field"), FT: cosName("Tx"), V: cosString("A".repeat(70000)) }));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([field]) }));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", doc.save());
  const original = Uint8Array.of(1, 2, 3); await fs.writeFile("/out.pdf", original);
  const controller = new AbortController(), reason = new Error("appearance staging failed"); let injected = false, opens = 0, closes = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => {
      const staged = await fs.createStagedFile!(...args), writer = staged.writer; if (!writer) return staged;
      return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) {
        if (mode !== "output-limit" && !injected && new TextDecoder().decode(bytes).includes("/Tx BMC q BT")) { injected = true; if (mode === "cancel") controller.abort(reason); else throw reason; }
        return writer.write(bytes, options);
      } } };
    };
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
      const handle = await fs.openReadFile!(...args); opens++;
      return { ...handle, async close() { closes++; await handle.close(); } };
    };
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file appearance I/O forbidden"); };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(["in.pdf", "out.pdf", "--generate-appearances"]);
  await assert.rejects(async () => createQpdfCommand(mode === "output-limit" ? { limits: { maxOutputBytes: 10 } } : {}).execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    signal: controller.signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } }), error => mode === "output-limit" ? error instanceof Error && error.message.includes("limit") : error === reason);
  assert.equal(injected, mode !== "output-limit"); assert.equal(opens, closes); assert.deepEqual(await fs.readFile("/out.pdf"), original); assert.deepEqual(await fs.readdir("/scratch"), []);
});

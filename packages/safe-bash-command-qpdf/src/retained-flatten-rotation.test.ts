import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, dictDelete, dictGet, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["90", "180", "270", "shared", "array", "annotations", "split", "selection", "rotate", "empty", "inline", "self-annotation", "inherited", "encrypted", "linearize", "objects", "slow", "unsupported"]) it(`flattens ${mode} rotation through caller storage`, async () => {
  const document = PdfDocument.create(), page = document.addPage(), other = document.addPage();
  if (mode !== "empty") page.setRawContentStream("1 0 0 rg 10 20 30 40 re f\n".repeat(3000));
  page.setRotation(mode === "180" ? 180 : mode === "270" ? 270 : 90); other.setRotation(270);
  if (mode === "shared") dictSet(other.dict, "Contents", dictGet(page.dict, "Contents")!);
  if (mode === "array") dictSet(page.dict, "Contents", document.cos.allocateObject(cosArray([dictGet(page.dict, "Contents")!])));
  const rect = () => cosArray([10, 20, 30, 40].map(value => cosNumber(value)));
  dictSet(page.dict, "CropBox", rect());
  if (mode === "annotations") dictSet(page.dict, "Annots", document.cos.allocateObject(cosArray([cosDict({ Rect: rect() }), document.cos.allocateObject(cosDict({ Rect: rect() }))])));
  if (mode === "inline") {
    const root = document.cos.resolveDict(document.cos.rootRef)!, tree = document.cos.resolveDict(dictGet(root, "Pages"))!;
    dictSet(tree, "Kids", cosArray([page.dict, other.dict]));
  }
  if (mode === "self-annotation") {
    const root = document.cos.resolveDict(document.cos.rootRef)!, tree = document.cos.resolveDict(dictGet(root, "Pages"))!;
    const kids = document.cos.resolve(dictGet(tree, "Kids"));
    if (kids?.kind === "array") { dictSet(page.dict, "Rect", rect()); dictSet(page.dict, "Annots", cosArray([kids.items[0]!])); }
  }
  if (mode === "inherited") {
    const root = document.cos.resolveDict(document.cos.rootRef)!, tree = document.cos.resolveDict(dictGet(root, "Pages"))!;
    dictSet(tree, "MediaBox", cosArray([10, 20, 310, 520].map(value => cosNumber(value))));
    dictDelete(page.dict, "MediaBox");
  }
  if (mode === "unsupported") { const stream = document.cos.resolve(dictGet(page.dict, "Contents")); if (stream?.kind === "stream") dictSet(stream.dict, "Filter", cosName("Unsupported")); }
  const input = document.save(mode === "encrypted" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : {}), args = ["in.pdf", "out.pdf", "--flatten-rotation", ...(mode === "encrypted" ? ["--password=reader"] : []), ...(mode === "linearize" ? ["--linearize"] : []), ...(mode === "objects" ? ["--object-streams=generate"] : []), ...(mode === "split" ? ["--split-pages"] : []), ...(mode === "selection" ? ["--pages", ".", "2,1,1", "--"] : []), ...(mode === "rotate" ? ["--rotate=+90:1"] : [])];
  let expectedError: Error | undefined, actualError: Error | undefined;
  const files = new Map([["in.pdf", input]]), expected = await runQpdfCli(args, files).catch((error: Error) => { expectedError = error; return { exitCode: 2, stdout: "", stderr: "" }; });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  let outstanding = 0, peak = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
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
    }; if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file flattening I/O"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
  const actual = await Promise.resolve(createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes.slice()); } } })).catch((error: Error) => { actualError = error; return { exitCode: 2 }; });
  assert.equal(actualError?.message, expectedError?.message);
  assert.equal(actual.exitCode, expected.exitCode); assert.equal(Buffer.concat(errors).toString(), expected.stderr);
  for (const [name, bytes] of files) if (name !== "in.pdf") assert.deepEqual(await fs.readFile(`/${name}`), bytes);
  assert.deepEqual(await fs.readdir("/scratch"), []);
  assert.equal(outstanding, 0); assert.ok(peak <= 65536);
});

import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosString, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["new", "remove", "replace", "duplicate", "missing", "direct", "indirect", "nested", "encrypted", "stdin", "generate", "linearize", "split", "selection", "odd", "odd-remove", "empty", "multi", "cycle", "large"]) it(`edits ${mode} attachments through caller storage`, async () => {
  const doc = PdfDocument.create(); doc.addPage(); doc.addPage();
  const root = doc.cos.resolveDict(doc.cos.rootRef)!;
  const spec = doc.cos.allocateObject(cosDict({ Type: cosName("Filespec"), F: cosString("old.txt") }));
  let tree = cosDict({ Names: cosArray([cosString("old"), spec, cosString("old"), spec]) });
  if (mode.startsWith("odd")) tree = cosDict({ Names: cosArray([cosString("tail")]) });
  if (mode === "cycle") { const ref = doc.cos.allocateObject(tree); dictSet(tree, "Kids", cosArray([ref])); }
  if (mode === "nested") tree = cosDict({ Kids: cosArray([doc.cos.allocateObject(tree)]) });
  if (mode !== "new") dictSet(root, "Names", mode === "indirect" ? doc.cos.allocateObject(cosDict({ EmbeddedFiles: doc.cos.allocateObject(tree) })) : cosDict({ EmbeddedFiles: tree }));
  const input = doc.save(mode === "encrypted" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : {}), payload = new Uint8Array(mode === "empty" ? 0 : mode === "large" ? 1048579 : 65539).fill(199);
  const inputName = mode === "stdin" ? "-" : "in.pdf";
  const args = [inputName, "out.pdf", ...(mode === "encrypted" ? ["--password=reader"] : []),
    ...(mode === "remove" ? ["--remove-attachment=old"] : ["--add-attachment", mode === "missing" ? "missing.bin" : "payload.bin", `--key=${mode === "replace" || mode === "duplicate" ? "old" : "new"}`, "--filename=data.bin", "--description=description", ...(mode === "replace" ? ["--replace"] : []), "--"]),
    ...(mode === "odd-remove" ? ["--remove-attachment=absent"] : []),
    ...(mode === "multi" ? ["--add-attachment", "payload.bin", "--key=new", "--replace", "--"] : []),
    ...(mode === "generate" ? ["--object-streams=generate"] : []), ...(mode === "linearize" ? ["--linearize"] : []), ...(mode === "split" ? ["--split-pages"] : []), ...(mode === "selection" ? ["--pages", ".", "2,1", "--"] : [])];
  const files = new Map([[inputName, input], ["payload.bin", payload]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/payload.bin", payload);
  let outstanding = 0, peak = 0, largestWrite = 0;
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args);
      return new Proxy(handle, { get(owner, key) {
        if (key === "write") return async (...args: Parameters<typeof handle.write>) => {
          const size = args[0].byteLength; outstanding += size; peak = Math.max(peak, outstanding); largestWrite = Math.max(largestWrite, size);
          try { if (mode === "large") await new Promise(resolve => setTimeout(resolve, 1)); return await handle.write(...args); }
          finally { outstanding -= size; }
        };
        const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
      } });
    };
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole attachment-edit I/O"); }; const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } });
  const carrier = createCommandArguments(args), stderr: Uint8Array[] = [];
  const actual = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* () { for (let at = 0; at < input.length; at += 4096) yield input.subarray(at, at + 4096); })(), stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } } });
  assert.equal(actual.exitCode, expected.exitCode); assert.equal(Buffer.concat(stderr).toString(), expected.stderr);
  for (const [name, bytes] of files) if (bytes !== input && bytes !== payload) assert.deepEqual(await fs.readFile(`/${name}`), bytes);
  assert.deepEqual(await fs.readdir("/scratch"), []);
  assert.equal(outstanding, 0); assert.ok(largestWrite <= 65536); assert.ok(peak <= 131072);
});

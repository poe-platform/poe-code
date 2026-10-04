import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosStream, cosArray, cosDict, cosName, cosString, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const mode of ["new", "existing", "nested", "indirect-array", "duplicate", "remove", "add", "encrypted", "empty", "source-nested", "odd", "missing", "repeat", "stdin"]) it(`copies ${mode} attachments through caller storage`, async () => {
  const doc = PdfDocument.create(); doc.addPage();
  const other = PdfDocument.create(); other.addPage();
  const root = doc.cos.resolveDict(doc.cos.rootRef)!, sourceRoot = other.cos.resolveDict(other.cos.rootRef)!;
  const payload = new Uint8Array(65539).fill(199), embedded = other.cos.allocateObject(cosStream(payload, { compress: true }));
  const spec = other.cos.allocateObject(cosDict({ Type: cosName("Filespec"), UF: cosString("payload.bin"), EF: cosDict({ F: embedded }) }));
  const sourceTree = mode === "source-nested" ? cosDict({ Names: cosArray([cosString("source")]), Kids: cosArray([other.cos.allocateObject(cosDict({ Names: cosArray([spec]) }))]) }) : cosDict({ Names: cosArray([cosString("source"), spec]) });
  if (mode !== "empty") dictSet(sourceRoot, "Names", cosDict({ EmbeddedFiles: sourceTree }));
  if (mode !== "new") {
    const pairs = cosArray([cosString(mode === "duplicate" ? "copied-source" : "old"), doc.cos.allocateObject(cosDict({ F: cosString("old") }))]);
    if (mode === "odd") pairs.items.push(cosString("tail"));
    const tree = cosDict({ Names: mode === "indirect-array" ? doc.cos.allocateObject(pairs) : pairs });
    if (mode === "nested") dictSet(tree, "Kids", cosArray([doc.cos.allocateObject(cosDict({ Names: cosArray([cosString("copied-source"), cosDict({ F: cosString("child") })]) }))]));
    dictSet(root, "Names", cosDict({ EmbeddedFiles: tree }));
  }
  const input = doc.save(), copied = other.save(mode === "encrypted" ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : {});
  const args = ["in.pdf", "out.pdf", "--copy-attachments-from", mode === "missing" ? "missing.pdf" : mode === "stdin" ? "-" : "source.pdf", "--prefix=copied-", ...(mode === "encrypted" ? ["--password=reader"] : []), "--",
    ...(mode === "repeat" ? ["--copy-attachments-from", "source.pdf", "--prefix=copied-", "--"] : []),
    ...(mode === "remove" ? ["--remove-attachment=copied-source"] : []), ...(mode === "add" ? ["--add-attachment", "payload.bin", "--key=added", "--"] : [])];
  const files = new Map([["in.pdf", input], [mode === "stdin" ? "-" : "source.pdf", copied], ["payload.bin", payload]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/payload.bin", payload); await fs.writeFile("/source.pdf", copied);
  let outstanding = 0, peak = 0, largestWrite = 0;
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args);
      return new Proxy(handle, { get(owner, key) {
        if (key === "write") return async (...args: Parameters<typeof handle.write>) => {
          const size = args[0].byteLength; outstanding += size; peak = Math.max(peak, outstanding); largestWrite = Math.max(largestWrite, size);
          try { await Promise.resolve(); return await handle.write(...args); }
          finally { outstanding -= size; }
        };
        const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
      } });
    };
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole attachment-edit I/O"); }; const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } });
  const carrier = createCommandArguments(args), stderr: Uint8Array[] = [];
  const actual = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* () { const bytes = mode === "stdin" ? copied : input; for (let at = 0; at < bytes.length; at += 4096) yield bytes.subarray(at, at + 4096); })(), stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } } });
  assert.equal(actual.exitCode, expected.exitCode); assert.equal(Buffer.concat(stderr).toString(), expected.stderr);
  for (const [name, bytes] of files) if (bytes !== input && bytes !== payload && bytes !== copied) assert.deepEqual(await fs.readFile(`/${name}`), bytes);
  assert.deepEqual(await fs.readdir("/scratch"), []);
  assert.equal(outstanding, 0); assert.ok(largestWrite <= 65536); assert.ok(peak <= 131072);
});

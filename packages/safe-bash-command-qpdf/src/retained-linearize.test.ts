import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { cosArray, cosDict, cosName, cosNumber, cosString, dictGet, dictSet, PdfDocument, serializeCosDocument } from "@poe-code/pdf-ast";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const layout of [["--qdf"], ["--normalize-content=y"], ["--stream-data=uncompress"], ["--compress-streams=y"], ["--object-streams=generate", "--qdf"], ["--object-streams=generate", "--qdf", "--normalize-content=n"], ["--linearize"], ["--object-streams=generate"], ["--linearize", "--object-streams=generate"]]) for (const mode of ["ordinary", "existing", "encrypted", "decrypt", "empty", "stdout", "replace", "selection", "split", "rotations", "removals", "inline", "identifier", "split-selection"]) it(`writes ${mode} (${layout.join(" ")}) through retained input and output`, async () => {
  const doc = PdfDocument.create(); doc.setTitle("Linearized output");
  for (let i = 0; i < 3; i++) doc.addPage().drawText(`Page ${i}`, { x: 20, y: 30 });
  const encrypted = mode === "encrypted" || mode === "decrypt";
  let input = doc.save(encrypted ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : { linearize: mode === "existing" });
  if (mode === "inline" || mode === "identifier") {
    if (mode === "inline") {
      const root = doc.cos.resolveDict(dictGet(doc.cos.resolveDict(doc.cos.rootRef)!, "Pages"))!;
      dictSet(root, "Kids", cosArray([cosDict({ Type: cosName("Page"), MediaBox: cosArray([0, 0, 100, 200].map(value => cosNumber(value))) })]));
      dictSet(root, "Count", cosNumber(1));
    }
    input = serializeCosDocument({ objects: [...doc.cos.objects.values()], rootRef: doc.cos.rootRef, infoRef: doc.cos.infoRef, idArray: cosArray([cosString("first"), cosString("second")]) });
  }
  const destination = mode === "stdout" ? "-" : mode === "replace" ? "in.pdf" : "out.pdf";
  const args = [...layout, ...(mode === "empty" ? ["--empty"] : ["in.pdf"]), ...(mode === "replace" ? ["--replace-input"] : [destination])];
  if (encrypted) args.push("--password=reader");
  if (mode === "decrypt") args.push("--decrypt");
  if ((mode === "selection" || mode === "split-selection")) args.push("--pages", ".", "3,1,2", "--");
  if ((mode === "split" || mode === "split-selection")) args.push("--split-pages=2");
  if (mode === "rotations") args.push("--rotate=+90:1-z");
  if (mode === "removals") args.push("--remove-info", "--remove-metadata", "--remove-structure", "--remove-page-labels");
  const files = new Map([["in.pdf", input]]), expected = await runQpdfCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file linearization I/O forbidden"); };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const carrier = createCommandArguments(args), stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { assert.ok(bytes.buffer.byteLength <= 65536); stdout.push(bytes.slice()); await Promise.resolve(); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } } });
  assert.equal(result.exitCode, expected.exitCode); assert.equal(Buffer.concat(stderr).toString(), expected.stderr);
  for (const [name, bytes] of files) {
    if (name === "in.pdf" && mode !== "replace") continue;
    assert.deepEqual(name === "-" ? new Uint8Array(Buffer.concat(stdout)) : await fs.readFile("/" + name), bytes, name);
  }
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

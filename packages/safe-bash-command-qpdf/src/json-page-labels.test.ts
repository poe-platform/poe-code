import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosString, dictSet } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const version of [1, 2]) for (const selected of [false, true]) it(`matches native JSON ${version} page labels (${selected ? "selected" : "default"})`, async () => {
  const doc = PdfDocument.create();
  for (let index = 0; index < 6; index++) doc.addPage();
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "PageLabels", cosDict({ Kids: cosArray([
    doc.cos.allocateObject(cosDict({ Nums: cosArray([
      cosNumber(0), cosDict({ S: cosName("r"), St: cosNumber(1) }),
      cosNumber(4), cosDict({ S: cosName("D"), St: cosNumber(3), P: cosString("π") }),
      cosNumber(5), cosDict({ P: cosString("") })
    ]) }))
  ]) }));
  // Native qpdf 12.4.2 includes /St even when the source omits it.
  const expected = [
    { index: 0, label: { "/S": "/r", "/St": 1 } },
    { index: 4, label: { "/S": "/D", "/St": 3, "/P": version === 1 ? "π" : "u:π" } },
    { index: 5, label: { "/St": 1, "/P": version === 1 ? "" : "u:" } }
  ];
  const input = doc.save(), args = [`--json=${version}`, ...(selected ? ["--json-key=pagelabels"] : []), "in.pdf"];
  const sync = runQpdfCliSync(args, new Map([["in.pdf", input]]));
  const buffered = await runQpdfCli(args, new Map([["in.pdf", input]]));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const chunks: Uint8Array[] = [];
  const retained = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} } });
  for (const result of [sync, buffered, retained]) assert.equal(result.exitCode, 0);
  for (const output of [sync.stdout, buffered.stdout, Buffer.concat(chunks).toString()]) assert.deepEqual(JSON.parse(output).pagelabels, expected);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

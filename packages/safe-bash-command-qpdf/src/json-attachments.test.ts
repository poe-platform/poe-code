import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument, cosArray, cosDict, cosName, cosString, cosHexString, cosStream, dictSet } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const version of [1, 2]) for (const selected of [false, true]) for (const metadata of [false, true]) it(`matches native attachment JSON ${version} selected=${selected} metadata=${metadata}`, async () => {
  const doc = PdfDocument.create(); doc.addPage();
  const stream = doc.cos.allocateObject(cosStream(cosDict({ Type: cosName("EmbeddedFile"), ...(metadata ? {
    Subtype: cosName("text/plain"), Params: cosDict({ CheckSum: cosHexString(new Uint8Array([0, 127, 255])),
      CreationDate: cosString("D:20261105060000-06'00'"), ModDate: cosString("D:20261105070000Z") })
  } : {}) }), new TextEncoder().encode("note")));
  const spec = doc.cos.allocateObject(cosDict({ Type: cosName("Filespec"), F: cosString("note.txt"), UF: cosString("π.txt"),
    ...(metadata ? { Desc: cosString("Audit note") } : {}), EF: cosDict({ F: stream, UF: stream }) }));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", cosDict({ EmbeddedFiles: cosDict({ Names: cosArray([cosString("note"), spec]) }) }));
  // qpdf 12.4.2 reports CreationDate for both date fields, even with a distinct ModDate.
  const streamInfo = { checksum: metadata ? "007fff" : null, creationdate: metadata ? "2026-11-05T06:00:00-06:00" : null,
    modificationdate: metadata ? "2026-11-05T06:00:00-06:00" : null, mimetype: metadata ? "text/plain" : null };
  const expected = { note: { description: metadata ? "Audit note" : null, filespec: `${spec.objectNumber} 0 R`,
    names: { "/F": "note.txt", "/UF": "π.txt" }, preferredcontents: `${stream.objectNumber} 0 R`, preferredname: "π.txt",
    streams: { "/F": streamInfo, "/UF": streamInfo } } };
  const input = doc.save(), args = [`--json=${version}`, ...(selected ? ["--json-key=attachments"] : []), "in.pdf"];
  const sync = runQpdfCliSync(args, new Map([["in.pdf", input]]));
  const buffered = await runQpdfCli(args, new Map([["in.pdf", input]]));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const chunks: Uint8Array[] = [];
  const retained = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} } });
  for (const result of [sync, buffered, retained]) assert.equal(result.exitCode, 0);
  for (const output of [sync.stdout, buffered.stdout, Buffer.concat(chunks).toString()]) assert.deepEqual(JSON.parse(output).attachments, expected);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});

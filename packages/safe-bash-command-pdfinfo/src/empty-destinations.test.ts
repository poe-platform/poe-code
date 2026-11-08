import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument, cosArray, cosDict, dictSet } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createPdfinfoCommand, inspectPdfBytes, runPdfinfoCli } from "./index.js";

for (const emptyTree of [false, true]) {
  for (const streaming of [false, true]) {
    it(`prints the destination header with ${emptyTree ? "an empty tree" : "no destinations"} (${streaming ? "streaming" : "buffered"})`, async () => {
      const doc = PdfDocument.create();
      doc.addPage([216, 144]);
      if (emptyTree) {
        dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", cosDict({
          Dests: cosDict({ Names: cosArray([]) })
        }));
      }
      const bytes = doc.save();
      const expected = { exitCode: 0, stdout: "Page  Destination                 Name\n", stderr: "" };
      if (!streaming) {
        assert.deepEqual(inspectPdfBytes(bytes, ["-dests", "-"]), expected);
        assert.deepEqual(await runPdfinfoCli(["-dests", "-"], new Map(), bytes), expected);
        return;
      }
      let stdout = "", stderr = "";
      const result = await createPdfinfoCommand().execute({
        command: "pdfinfo", args: ["-dests", "-"], cwd: "/", env: {},
        fs: createMemoryFileSystem(), signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      assert.deepEqual({ exitCode: result.exitCode, stdout, stderr }, expected);
    });
  }
}

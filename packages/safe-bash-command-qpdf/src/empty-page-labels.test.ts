import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { PdfDocument } from "@poe-code/pdf-ast";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const spec of ["1:", "1:/1/Prefix"]) {
  for (const retained of [false, true]) {
    it(`omits the numbering style for ${spec} (${retained ? "retained" : "buffered"})`, async () => {
      const doc = PdfDocument.create(); doc.addPage();
      const input = doc.save();
      const args = ["in.pdf", "out.pdf", "--set-page-labels", spec, "--"];
      let output: Uint8Array;
      if (retained) {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
        const carrier = createCommandArguments(args);
        const result = await createQpdfCommand().execute({
          command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/",
          env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write() {} }, stderr: { async write() {} },
        });
        assert.equal(result.exitCode, 0);
        output = await fs.readFile("/out.pdf");
      } else {
        const files = new Map([["in.pdf", input]]);
        const result = await runQpdfCli(args, files);
        assert.equal(result.exitCode, 0, result.stderr);
        output = files.get("out.pdf")!;
      }
      const pdf = await PDFDocument.load(output);
      const labels = pdf.catalog.lookup(PDFName.of("PageLabels"), PDFDict);
      const label = labels.lookup(PDFName.of("Nums"), PDFArray).lookup(1, PDFDict);
      // Native qpdf 12.4.2 omits /S for both specifications.
      assert.equal(label.has(PDFName.of("S")), false);
      if (spec === "1:") assert.equal(label.has(PDFName.of("P")), false);
      else assert.equal(label.lookup(PDFName.of("P"), PDFString).decodeText(), "Prefix");
    });
  }
}

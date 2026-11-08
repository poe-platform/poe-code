import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { PdfDocument } from "@poe-code/pdf-ast";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const [position, style, offset] of [["z", "r", 1], ["r1", "r", 1], ["r2", "A", 2]] as const) {
  for (const selected of [false, true]) {
    for (const mode of ["buffered", "sync", "retained"] as const) {
      it(`resolves ${position} page labels (${mode}, selected=${selected})`, async () => {
        const doc = PdfDocument.create(); for (let i = 0; i < 6; i++) doc.addPage();
        const input = doc.save();
        const args = ["in.pdf", "out.pdf", "--set-page-labels", "1:D", `${position}:${style}`, "--", ...(selected ? ["--pages", ".", "2-5", "--"] : [])];
        let output: Uint8Array;
        if (mode === "retained") {
          const fs = createMemoryFileSystem();
          await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
          const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
          const result = await createQpdfCommand().execute({
            command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/",
            env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
          });
          assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
          output = await fs.readFile("/out.pdf");
          assert.deepEqual(await fs.readdir("/scratch"), []);
        } else {
          const files = new Map([["in.pdf", input]]);
          const result = await (mode === "sync" ? runQpdfCliSync : runQpdfCli)(args, files);
          assert.equal(result.exitCode, 0, result.stderr);
          output = files.get("out.pdf")!;
        }
        const pdf = await PDFDocument.load(output);
        const labels = pdf.catalog.lookup(PDFName.of("PageLabels"), PDFDict).lookup(PDFName.of("Nums"), PDFArray);
        assert.equal(labels.size(), 4);
        assert.equal(labels.lookup(0, PDFNumber).asNumber(), 0);
        assert.equal(labels.lookup(1, PDFDict).lookup(PDFName.of("S"), PDFName).asString(), "/D");
        // Native qpdf resolves these positions against the selected output pages.
        assert.equal(labels.lookup(2, PDFNumber).asNumber(), (selected ? 4 : 6) - offset);
        assert.equal(labels.lookup(3, PDFDict).lookup(PDFName.of("S"), PDFName).asString(), `/${style}`);
      });
    }
  }
}

for (const specs of [["1:D", "z:r", "r2:A"], ["1:D", "z:r", "r1:A"], ["z:D"]]) {
  it(`rejects relative label order ${specs.join(" ")} without overwriting output`, async () => {
    const doc = PdfDocument.create(); for (let i = 0; i < 6; i++) doc.addPage();
    const input = doc.save(), original = new TextEncoder().encode("existing output");
    const args = ["in.pdf", "out.pdf", "--set-page-labels", ...specs, "--"];
    const diagnostic = specs.length === 1 ? "the first page label specification must start with page 1" : "page label specifications must be in order by first page";
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      const files = new Map([["in.pdf", input], ["out.pdf", original]]);
      const result = await run(args, files);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stderr, `qpdf: ${diagnostic}\n`);
      assert.deepEqual(files.get("out.pdf"), original);
    }
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/out.pdf", original);
    const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() { assert.fail("unexpected stdout"); } }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } } });
    assert.equal(result.exitCode, 2);
    assert.equal(Buffer.concat(errors).toString(), `qpdf: ${diagnostic}\n`);
    assert.deepEqual(await fs.readFile("/out.pdf"), original);
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}

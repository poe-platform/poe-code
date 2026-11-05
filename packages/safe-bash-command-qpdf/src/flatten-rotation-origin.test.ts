import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosNumber, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const retained of [false, true]) for (const explicitCrop of [false, true]) for (const rotation of [90, 180, 270] as const) {
  it(`preserves offset page geometry at ${rotation} degrees (${retained ? "retained" : "buffered"}, crop=${explicitCrop})`, async () => {
    const document = PdfDocument.create(), page = document.addPage();
    dictSet(page.dict, "MediaBox", cosArray([30, 20, 230, 120].map(value => cosNumber(value))));
    if (explicitCrop) dictSet(page.dict, "CropBox", cosArray([40, 30, 210, 110].map(value => cosNumber(value))));
    page.setRotation(rotation);
    page.setRawContentStream("1 0 0 rg 50 40 30 40 re f\n");
    const input = document.save(), args = ["in.pdf", "out.pdf", "--flatten-rotation"];
    let output: Uint8Array;
    if (retained) {
      const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
      const carrier = createCommandArguments(args);
      const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
      assert.equal(result.exitCode, 0);
      output = await fs.readFile("/out.pdf");
      assert.deepEqual(await fs.readdir("/scratch"), []);
    } else {
      const files = new Map([["in.pdf", input]]);
      assert.equal((await runQpdfCli(args, files)).exitCode, 0);
      output = files.get("out.pdf")!;
    }
    const flattened = PdfDocument.load(output).getPage(0);
    const media = rotation === 180 ? [30, 20, 230, 120] : [20, 30, 120, 230];
    const crop = rotation === 90 ? [30, 50, 110, 220] : rotation === 180 ? [50, 30, 220, 110] : [30, 40, 110, 210];
    assert.deepEqual(flattened.getMediaBox(), media);
    assert.deepEqual(flattened.getCropBox(), explicitCrop ? crop : media);
    assert.equal(flattened.getRotation(), 0);
    const matrix = rotation === 90 ? "0 -1 1 0 0 260" : rotation === 180 ? "-1 0 0 -1 260 140" : "0 1 -1 0 140 0";
    assert.equal(new TextDecoder().decode(flattened.getRawContentStream()), `q\n${matrix} cm\n1 0 0 rg 50 40 30 40 re f\n\nQ\n`);
  });
}

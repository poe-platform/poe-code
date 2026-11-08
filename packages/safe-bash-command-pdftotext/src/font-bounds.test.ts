import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runPdftotextCli } from "./index.js";

for (const mode of ["-bbox", "-bbox-layout"]) {
  for (const [size, xMax, yMin, yMax] of [
    [12, "47.336000", "15.384000", "26.484000"],
    [20, "65.560000", "9.640000", "28.140000"],
  ] as const) {
    it(`${mode} matches Poppler Helvetica bounds at ${size}pt`, async () => {
      const doc = PdfDocument.create();
      doc.addPage([216, 144]).drawText("Hello", { x: 20, y: 120, size });
      const result = await runPdftotextCli([mode, "in.pdf", "-"], new Map([["in.pdf", doc.save()]]));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(result.output.includes(`<word xMin="20.000000" yMin="${yMin}" xMax="${xMax}" yMax="${yMax}">Hello</word>`), result.output);
    });
  }
}

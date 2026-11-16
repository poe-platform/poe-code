import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfDocument, cosArray, cosNumber, dictSet } from "@poe-code/pdf-ast";
import { extractPdfToTextBytes } from "./index.js";

for (const rotation of [0, 90, 180, 270] as const)
  test(`word crop rebuilds enclosing bounds on shifted page ${rotation}`, () => {
    const doc = PdfDocument.create(),
      page = doc.addPage([200, 200]);
    dictSet(page.pageDict, "MediaBox", cosArray([30, 40, 230, 240].map((n) => cosNumber(n))));
    dictSet(page.pageDict, "CropBox", cosArray([30, 40, 230, 200].map((n) => cosNumber(n))));
    page.setRotation(rotation);
    page.drawText("Alpha Beta", { x: 50, y: 170, size: 12 });
    const input = doc.save();
    for (const [dpi, width] of [
      [72, 55],
      [144, 110]
    ] as const) {
      const result = extractPdfToTextBytes(input, [
        "-bbox-layout",
        "-cropbox",
        "-r",
        String(dpi),
        "-W",
        String(width)
      ]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.match(result.output, /<page width="200.000000" height="160.000000">/);
      assert.ok(!result.output.includes("Beta"));
      const scale = dpi / 72;
      const bounds = `xMin="${(20 * scale).toFixed(6)}" yMin="${(21.384 * scale).toFixed(6)}" xMax="${(50.684 * scale).toFixed(6)}" yMax="${(32.484 * scale).toFixed(6)}"`;
      for (const tag of ["block", "line", "word"])
        assert.ok(result.output.includes(`<${tag} ${bounds}>`), result.output);
      assert.ok(result.output.includes(`>Alpha</word>`));
    }
  });

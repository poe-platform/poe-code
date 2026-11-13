import assert from "node:assert/strict";
import test from "node:test";
import { decodePng } from "@poe-code/pdf-ast";
import { RustWasmBash } from "./index.js";
import { clippingCases, clippingPdf } from "../tests/fixtures/path-clipping.mjs";

for (const fixture of clippingCases) {
  test(`PDF path clipping: ${fixture.name}`, async () => {
    const bash = new RustWasmBash({cwd: "/"});
    try {
      await bash.fs.writeFile("/input.pdf", fixture.pdf);
      for (const command of ["pdftoppm", "pdftocairo"]) {
        const result = await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`);
        assert.equal(result.exitCode, 0, result.stderr);
        const png = decodePng(await bash.fs.readFile("/page.png"));
        for (const [x, y, ...rgb] of fixture.probes) {
          const i = (y * png.width + x) * 4;
          assert.deepEqual([...png.data.slice(i, i + 3)], rgb, `${command} at ${x},${y}`);
        }
      }
    } finally { await bash.dispose(); }
  });
}

test("PDF path clipping failures preserve output", async () => {
  const bash = new RustWasmBash({cwd: "/"});
  try {
    for (const [content, limits] of [
      ["20 20 60 60 re 1 W n", {}],
      ["20 20 60 60 re W", {}],
      ["0 0 100 100 re W n 1 0 0 rg 0 0 100 100 re f", {maxInputBytes: 40000}],
    ]) {
      await bash.fs.writeFile("/input.pdf", clippingPdf(content));
      for (const command of ["pdftoppm", "pdftocairo"]) {
        await bash.fs.writeFile("/page.png", "existing");
        const result = await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`, {limits});
        assert.notEqual(result.exitCode, 0);
        assert.equal(Buffer.from(await bash.fs.readFile("/page.png")).toString(), "existing");
      }
    }
  } finally { await bash.dispose(); }
});

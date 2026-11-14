import assert from "node:assert/strict";
import test from "node:test";
import { decodePng } from "@poe-code/pdf-ast";
import { shadingCases, shadingPdf } from "safe-bash-command-pdftoppm/testing/axial-shading";
import { RustWasmBash } from "./index.js";

test("Wasm axial shading: fixture, transforms, Extend, bbox and clipping", async () => {
  const bash = new RustWasmBash();
  try {
    for (const { name, pdf, probes } of shadingCases) {
      await bash.fs.writeFile("/input.pdf", pdf);
      for (const command of ["pdftoppm", "pdftocairo"]) {
        const result = await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`);
        assert.equal(result.exitCode, 0, `${name}: ${result.stderr}`);
        const png = decodePng(await bash.fs.readFile("/page.png"));
        for (const [x, y, ...expected] of probes) {
          const pixel = png.data.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 3);
          expected.forEach((v, i) => assert.ok(Math.abs(pixel[i] - v) <= 3, `${command} ${name} ${x},${y}: ${pixel}`));
        }
      }
    }
    for (const settings of ["/Coords [0 0 100 0] /Extend [bad true]", "/Coords [0 0 0 0]", "/ShadingType 3 /Coords [0 0 100 0]", "/Coords [0 0 100 0] /Function << /FunctionType 4 >>"]) {
      await bash.fs.writeFile("/input.pdf", shadingPdf("/Blend sh", settings));
      for (const command of ["pdftoppm", "pdftocairo"]) {
        await bash.fs.writeFile("/page.png", Buffer.from("existing"));
        assert.notEqual((await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`)).exitCode, 0);
        assert.equal(Buffer.from(await bash.fs.readFile("/page.png")).toString(), "existing");
      }
    }
  } finally { await bash.dispose(); }
});

test("Wasm shading work budget preserves existing output", async () => {
  const bash = new RustWasmBash();
  try {
    bash.setLimits({ maxInputBytes: 100_000 });
    await bash.fs.writeFile("/input.pdf", shadingPdf("/Blend sh ".repeat(20), "/Coords [0 0 100 0]"));
    for (const command of ["pdftoppm", "pdftocairo"]) {
      await bash.fs.writeFile("/page.png", Buffer.from("existing"));
      assert.notEqual((await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`)).exitCode, 0);
      assert.equal(Buffer.from(await bash.fs.readFile("/page.png")).toString(), "existing");
    }
  } finally { await bash.dispose(); }
});

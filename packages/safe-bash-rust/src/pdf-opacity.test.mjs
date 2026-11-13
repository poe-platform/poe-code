import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodePng } from "@poe-code/pdf-ast";
import { RustWasmBash } from "./index.js";

const input = readFileSync(new URL("../tests/fixtures/constant-opacity.pdf", import.meta.url));
test("Wasm constant fill/stroke opacity restores q/Q and Form state", async () => {
  const bash = new RustWasmBash();
  try {
    await bash.fs.writeFile("/input.pdf", input);
    for (const command of ["pdftoppm", "pdftocairo"]) {
      const result = await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`);
      assert.equal(result.exitCode, 0, result.stderr);
      const png = decodePng(await bash.fs.readFile("/page.png"));
      for (const y of [20, 40, 50, 60, 70, 80, 90, 95]) {
        const colors = y === 50 ? [[255, 0, 0], [0, 0, 255], [255, 0, 0]]
          : y === 95 ? [[127, 0, 128], [191, 0, 64], [255, 0, 0]]
          : [[255, 0, 0], [128, 0, 128], [0, 0, 255]];
        for (const [column, x] of [20, 50, 80].entries()) {
          const pixel = png.data.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 3);
          colors[column].forEach((value, i) => assert.ok(Math.abs(pixel[i] - value) <= 1, `${command} (${x},${y}): ${pixel}`));
        }
      }
    }
  } finally { await bash.dispose(); }
});

test("Wasm malformed opacity preserves output", async () => {
  const bash = new RustWasmBash();
  try {
    for (const value of ["bad", "2.0", "-01"]) {
      await bash.fs.writeFile("/input.pdf", Buffer.from(input.toString("latin1").replace("/ca 0.5", `/ca ${value}`), "latin1"));
      for (const command of ["pdftoppm", "pdftocairo"]) {
        await bash.fs.writeFile("/page.png", Buffer.from("existing"));
        assert.notEqual((await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`)).exitCode, 0);
        assert.equal(Buffer.from(await bash.fs.readFile("/page.png")).toString(), "existing");
      }
    }
  } finally { await bash.dispose(); }
});

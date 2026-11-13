import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodePng } from "@poe-code/pdf-ast";
import { RustWasmBash } from "./index.js";

const input = readFileSync(new URL("../tests/fixtures/blend-modes.pdf", import.meta.url));
test("Wasm PDF blend modes cover paints, opacity, q/Q and Form scopes", async () => {
  const bash = new RustWasmBash();
  try {
    await bash.fs.writeFile("/input.pdf", input);
    for (const command of ["pdftoppm", "pdftocairo"]) {
      const result = await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`);
      assert.equal(result.exitCode, 0, result.stderr);
      const png = decodePng(await bash.fs.readFile("/page.png"));
      for (const [row, blend] of [[0,0,255], [0,0,0], [255,0,255], [255,0,255]].entries()) {
        const y = 85 - row * 20;
        for (const [column, x] of [8,28,48,68,84,108,128,148,168,188].entries()) {
          const expected = column === 5 ? [255,0,255] : column === 7 ? [(255+blend[0])/2,0,blend[2]/2] : column === 8 ? [0,0,255] : blend;
          const pixel = png.data.slice((y*200+x)*4, (y*200+x)*4+3);
          expected.forEach((v,i) => assert.ok(Math.abs(pixel[i]-v) <= 2, `${command} (${x},${y}): ${pixel}`));
        }
      }
      assert.deepEqual([...png.data.slice((5*200+8)*4, (5*200+8)*4+3)], [0,255,0]);
    }
  } finally { await bash.dispose(); }
});
test("Wasm invalid blend modes preserve existing output", async () => {
  const bash = new RustWasmBash();
  try {
    for (const value of ["/Unknown ", "123456789", "[]       ", "[/Bad]   ", "null     ", "9 0 R    ", "[/Bad 1] "]) {
      await bash.fs.writeFile("/input.pdf", Buffer.from(input.toString("latin1").replace("/BM /Multiply", `/BM ${value}`), "latin1"));
      for (const command of ["pdftoppm", "pdftocairo"]) {
        await bash.fs.writeFile("/page.png", Buffer.from("existing"));
        assert.notEqual((await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`)).exitCode, 0);
        assert.equal(Buffer.from(await bash.fs.readFile("/page.png")).toString(), "existing");
      }
    }
  } finally { await bash.dispose(); }
});

test("Wasm accepts blend-mode arrays", async () => {
  const bash = new RustWasmBash();
  try {
    await bash.fs.writeFile("/input.pdf", Buffer.from(input.toString("latin1").replace("/BM /Difference", "/BM [/Multiply]"), "latin1"));
    for (const command of ["pdftoppm", "pdftocairo"]) {
      const result = await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`);
      assert.equal(result.exitCode, 0, result.stderr);
      const png = decodePng(await bash.fs.readFile("/page.png"));
      assert.deepEqual([...png.data.slice((25*200+8)*4, (25*200+8)*4+3)], [0,0,0]);
    }
  } finally { await bash.dispose(); }
});

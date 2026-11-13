import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodePng } from "@poe-code/pdf-ast";
import { RustWasmBash } from "./index.js";

const fixtures = new URL("../tests/fixtures/", import.meta.url);
const cases = readFileSync(new URL("pdf-groups.txt", fixtures), "utf8")
  .trim().split("\n").filter(line => !line.startsWith("#")).map(line => line.split(" "));
test("Wasm transparency groups match independent renderer pixels", async () => {
  const bash = new RustWasmBash();
  try {
    for (const name of new Set(cases.map(row => row[0]))) {
      await bash.fs.writeFile("/input.pdf", readFileSync(new URL(`${name}.pdf`, fixtures)));
      for (const command of ["pdftoppm", "pdftocairo"]) {
        const result = await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`);
        assert.equal(result.exitCode, 0, result.stderr);
        const png = decodePng(await bash.fs.readFile("/page.png"));
        for (const row of cases.filter(row => row[0] === name)) {
          const [x, y, ...rgb] = row.slice(1).map(Number);
          const at = (y * png.width + x) * 4;
          rgb.forEach((value, i) => assert.ok(Math.abs(png.data[at + i] - value) <= 2, `${command} ${row}: ${png.data.slice(at, at + 3)}`));
        }
      }
    }
  } finally { await bash.dispose(); }
});

test("Wasm rejects unsupported groups and bounds live intermediate surfaces atomically", async () => {
  const input = readFileSync(new URL("group-true.pdf", fixtures));
  const failures = [
    ...[["/K false", "/K true "], ["/I true", "/I nope"], ["/I true /K false", "/CS /DeviceCMYK "]]
      .map(([from, to]) => [Buffer.from(input.toString("latin1").replace(from, to), "latin1"), 100]),
    [input, 1100],
    [readFileSync(new URL("group-nested-true.pdf", fixtures)), 900],
  ];
  const bash = new RustWasmBash();
  try {
    for (const [pdf, scale] of failures) {
      await bash.fs.writeFile("/input.pdf", pdf);
      for (const command of ["pdftoppm", "pdftocairo"]) {
        await bash.fs.writeFile("/page.png", Buffer.from("existing"));
        const result = await bash.exec(`${command} -png -scale-to ${scale} -singlefile /input.pdf /page`);
        assert.notEqual(result.exitCode, 0, `${command} scale ${scale}`);
        assert.equal(Buffer.from(await bash.fs.readFile("/page.png")).toString(), "existing");
      }
    }
  } finally { await bash.dispose(); }
});

test("Wasm groups retain transparency without baking in a white backdrop", async () => {
  const bash = new RustWasmBash();
  try {
    for (const name of ["group-true", "group-false", "group-none"]) {
      await bash.fs.writeFile("/input.pdf", readFileSync(new URL(`${name}.pdf`, fixtures)));
      const result = await bash.exec("pdftocairo -png -transp -r 72 -singlefile /input.pdf /page");
      assert.equal(result.exitCode, 0, result.stderr);
      const png = decodePng(await bash.fs.readFile("/page.png"));
      for (const [x, y, expected] of [
        [50, 50, name === "group-none" ? [85, 0, 170, 192] : [0, 0, 255, 128]],
        [80, 20, [0, 0, 255, 128]],
        [95, 5, [0, 0, 0, 0]],
      ]) {
        const at = (y * 100 + x) * 4;
        expected.forEach((v, i) => assert.ok(Math.abs(png.data[at+i] - v) <= 2, `${name}: ${png.data.slice(at, at+4)}`));
      }
    }
  } finally { await bash.dispose(); }
});

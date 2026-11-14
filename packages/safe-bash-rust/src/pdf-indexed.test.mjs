import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { decodePng } from "@poe-code/pdf-ast";
import { RustWasmBash } from "./index.js";

const fixtures = new URL("../tests/fixtures/indexed/", import.meta.url);
const probes = ["pixels.txt", "spec-pixels.txt"].flatMap(name => readFileSync(new URL(name, fixtures), "utf8").trim().split("\n").filter(line => !line.startsWith("#")).map(line => line.split(" ")));
const hashes = new Set(readFileSync(new URL("png-sha256.txt", fixtures), "utf8").trim().split("\n"));

test("Wasm Indexed images match reference pixels and native output, rejecting invalid palettes", async () => {
  const bash = new RustWasmBash();
  try {
    for (const file of readdirSync(fixtures).filter(name => name.endsWith(".pdf"))) {
      for (const command of ["pdftoppm", "pdftocairo"]) {
        await bash.fs.writeFile("/input.pdf", readFileSync(new URL(file, fixtures)));
        await bash.fs.writeFile("/page.png", Buffer.from("existing"));
        const result = await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`);
        const bytes = await bash.fs.readFile("/page.png");
        if (file.startsWith("bad-")) {
          assert.notEqual(result.exitCode, 0, `${command} ${file}`);
          assert.equal(Buffer.from(bytes).toString(), "existing");
          continue;
        }
        assert.equal(result.exitCode, 0, `${command} ${file}: ${result.stderr}`);
        const digest = createHash("sha256").update(bytes).digest("hex");
        assert.ok(hashes.has(`${file.slice(0, -4)} ${command} ${digest}`), `native/Wasm PNG parity: ${command} ${file}`);
        const png = decodePng(bytes);
        for (const row of probes.filter(row => `${row[0]}.pdf` === file)) {
          const [x, y, ...rgb] = row.slice(1).map(Number);
          const at = (y * png.width + x) * 4;
          rgb.forEach((value, i) => assert.ok(Math.abs(png.data[at + i] - value) <= 2, `${command} ${row}: ${png.data.slice(at, at + 3)}`));
        }
        if (file === "interpolate.pdf") {
          await bash.fs.writeFile("/input.pdf", readFileSync(new URL("rgb-interpolate.pdf", fixtures)));
          const rgb = await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`);
          assert.equal(rgb.exitCode, 0, rgb.stderr);
          assert.deepEqual(bytes, await bash.fs.readFile("/page.png"));
        }
      }
    }
  } finally { await bash.dispose(); }
});

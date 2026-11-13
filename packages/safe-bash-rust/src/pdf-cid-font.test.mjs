import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodePng } from "@poe-code/pdf-ast";
import { runPdftoppmCli, runPdftocairoCli } from "../../safe-bash-command-pdftoppm/dist/index.js";
import { RustWasmBash } from "./index.js";

const input = readFileSync(new URL("../tests/fixtures/cid-truetype.pdf", import.meta.url));
const cases = JSON.parse(readFileSync(new URL("../tests/fixtures/cid-font-cases.json", import.meta.url), "utf8"));
test("Wasm Identity-H CID fonts match TypeScript and preserve outputs on errors", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [command, run] of [["pdftoppm", runPdftoppmCli], ["pdftocairo", runPdftocairoCli]]) {
      const outputs = new Map();
      for (const {name, update, expected, same} of cases) {
        const bytes = Buffer.concat([input, Buffer.from(update)]);
        await bash.fs.writeFile("/input.pdf", bytes);
        await bash.fs.writeFile("/page.png", Buffer.from("existing"));
        const result = await bash.exec(`${command} -png -r 72 -singlefile /input.pdf /page`);
        const output = await bash.fs.readFile("/page.png");
        if (expected === "error") {
          assert.notEqual(result.exitCode, 0, `${command} ${name}`);
          assert.equal(Buffer.from(output).toString(), "existing");
          continue;
        }
        assert.equal(result.exitCode, 0, `${command} ${name}: ${result.stderr}`);
        if (same) assert.deepEqual(output, outputs.get(same), name);
        outputs.set(name, output);
        const files = new Map([["input.pdf", bytes]]);
        assert.equal((await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files)).exitCode, 0);
        const actual = decodePng(output), reference = decodePng(files.get("page.png"));
        assert.deepEqual([actual.width, actual.height], [420, 120]);
        let error = 0, ink = 0;
        for (let i = 0; i < actual.data.length; i += 4) {
          if (actual.data[i] < 150) ink++;
          for (let c = 0; c < 3; c++) error += Math.abs(actual.data[i + c] - reference.data[i + c]);
        }
        assert.ok(error / (420 * 120 * 3) < 2, `${command} ${name}: mean RGB error ${error / (420 * 120 * 3)}`);
        if (expected === "blank") assert.equal(ink, 0);
        else assert.ok(ink > 150, `${name}: ${ink} ink pixels`);
      }
    }
  } finally { await bash.dispose(); }
});

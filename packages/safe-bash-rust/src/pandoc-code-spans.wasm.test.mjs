import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("../../safe-bash-command-pandoc/src/fixtures/code-spans.json", import.meta.url), "utf8"));

test("Pandoc code spans match shared fixtures through Wasm", async () => {
  const bash = await createRustWasmBash({forceNative: true, cwd: "/"});
  try {
    for (const fixture of fixtures) {
      await bash.fs.writeFile("/input.md", fixture.source);
      for (const format of ["json", "html", "plain"]) {
        const result = await bash.exec(`pandoc -f markdown -t ${format} /input.md`);
        assert.equal(result.exitCode, 0, result.stderr);
        if (format === "json") assert.deepEqual(JSON.parse(result.stdout).blocks, fixture.blocks, fixture.name);
        else assert.equal(result.stdout, fixture[format], `${fixture.name}: ${format}`);
      }
    }
  } finally {await bash.dispose();}
});

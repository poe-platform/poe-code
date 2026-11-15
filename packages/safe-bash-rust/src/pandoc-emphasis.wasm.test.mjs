import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("../../safe-bash-command-pandoc/src/fixtures/emphasis.json", import.meta.url), "utf8"));

test("Pandoc Wasm preserves emphasis and literal delimiters", async () => {
  const bash = await createRustWasmBash({forceNative: true, cwd: "/"});
  try {
    for (const fixture of fixtures) {
      await bash.fs.writeFile("/input.md", fixture.source);
      for (const to of ["json", "html", "plain"]) {
        const result = await bash.exec(`pandoc -f markdown -t ${to} /input.md`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(to === "json" ? JSON.parse(result.stdout).blocks : result.stdout,
          to === "json" ? fixture.blocks : fixture[to], `${fixture.name}: ${to}`);
      }
    }
  } finally {
    await bash.dispose();
  }
});

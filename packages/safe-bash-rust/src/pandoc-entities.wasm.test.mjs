import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

const cases = JSON.parse(readFileSync(new URL("../../safe-bash-command-pandoc/conformance/markdown-entities.json", import.meta.url), "utf8"));
test("Pandoc Markdown references decode once through Wasm", async () => {
  const bash = await createRustWasmBash({forceNative: true});
  try {
    for (const fixture of cases) {
      for (const to of ["json", "plain", "html"]) {
        const result = await bash.exec(`pandoc -f markdown -t ${to}`, {stdin: fixture.input});
        assert.equal(result.exitCode, 0, result.stderr);
        if (to === "json") assert.deepEqual(JSON.parse(result.stdout).blocks, fixture.blocks, fixture.name);
        else assert.equal(result.stdout, fixture[to], `${fixture.name} ${to}`);
      }
    }
  } finally { await bash.dispose(); }
});

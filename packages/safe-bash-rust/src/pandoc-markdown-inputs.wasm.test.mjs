import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

for (const name of ["unicode-attributes", "input-normalization", "smart", "smart-crossings"]) {
  const fixtures = JSON.parse(readFileSync(new URL(`../tests/fixtures/pandoc-${name}.json`, import.meta.url), "utf8"));
  test(`Pandoc native Wasm matches JavaScript ${name} fixtures`, async () => {
    const bash = await createRustWasmBash({forceNative: true, cwd: "/"});
    try {
      for (const fixture of fixtures) {
        await bash.fs.writeFile("/input.md", fixture.source);
        const result = await bash.exec(`pandoc -f ${fixture.from} -t json /input.md`);
        assert.equal(result.exitCode, 0, result.stderr);
        const document = JSON.parse(result.stdout);
        assert.deepEqual(document.blocks, fixture.blocks, `${fixture.from}: ${JSON.stringify(fixture.source)}`);
        if (fixture.meta) assert.deepEqual(document.meta, fixture.meta);
      }
    } finally {
      await bash.dispose();
    }
  });
}

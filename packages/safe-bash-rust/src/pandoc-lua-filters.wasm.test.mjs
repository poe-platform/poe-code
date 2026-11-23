import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

const cases = JSON.parse(readFileSync(new URL("../tests/fixtures/pandoc-lua-filters.json", import.meta.url), "utf8"));
for (const fixture of cases) {
  test(`Pandoc rejects unsupported Lua filters without publication: ${fixture.id}`, async () => {
    const bash = await createRustWasmBash({forceNative: true, cwd: "/"});
    try {
      await bash.fs.writeFile("/a.md", "a");
      await bash.fs.writeFile("/upper.lua", fixture.script);
      await bash.fs.writeFile("/saved", "KEEP");
      const control = await bash.exec("pandoc -f markdown -t plain /a.md");
      assert.equal(control.exitCode, 0, control.stderr);
      assert.equal(control.stdout, "a\n");
      for (const output of ["", "-o /saved"]) {
        const result = await bash.exec(`pandoc -f markdown -t plain /a.md ${output} ${fixture.flags.join(" ")}`);
        assert.equal(result.exitCode, 3, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "E_CAPABILITY: Lua filters are not supported by native Pandoc\n");
        assert.deepEqual(await bash.fs.readFile("/saved"), new TextEncoder().encode("KEEP"));
      }
    } finally { await bash.dispose(); }
  });
}

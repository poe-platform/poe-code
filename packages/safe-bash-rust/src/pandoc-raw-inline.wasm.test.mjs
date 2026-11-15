import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("../../safe-bash-command-pandoc/src/fixtures/inline-html.json", import.meta.url), "utf8"));
function rawInlines(value) {
  if (Array.isArray(value)) return value.flatMap(rawInlines);
  if (!value || typeof value !== "object") return [];
  return value.t === "RawInline" ? [value] : Object.values(value).flatMap(rawInlines);
}
test("Pandoc inline HTML follows shared parser and writer fixtures in Wasm", async () => {
  const bash = await createRustWasmBash({forceNative: true, cwd: "/"});
  try {
    for (const fixture of fixtures) {
      await bash.fs.writeFile("/input", fixture.source);
      const result = await bash.exec(`pandoc -f ${fixture.from} -t ${fixture.to} ${(fixture.args ?? []).join(" ")} /input`);
      if (fixture.error) {assert.notEqual(result.exitCode, 0, fixture.name); assert.equal(result.stdout, ""); continue;}
      assert.equal(result.exitCode, 0, `${fixture.name}: ${result.stderr}`);
      if (fixture.blocks) assert.deepEqual(JSON.parse(result.stdout).blocks, fixture.blocks, fixture.name);
      else if (fixture.raw) assert.deepEqual(rawInlines(JSON.parse(result.stdout)), fixture.raw, fixture.name);
      else assert.equal(result.stdout, fixture.output, fixture.name);
    }
    await bash.fs.writeFile("/saved.txt", "KEEP");
    await bash.fs.writeFile("/input", "before\n\n- a<!-- hidden -->b");
    const result = await bash.exec("pandoc -f markdown -t plain /input -o /saved.txt");
    assert.notEqual(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(await bash.fs.readFile("/saved.txt")), "KEEP");
  } finally {await bash.dispose();}
});

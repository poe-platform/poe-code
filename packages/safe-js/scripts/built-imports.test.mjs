import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
for (const [name, entry] of Object.entries(manifest.exports)) {
  test(`built ${name} export initializes in a fresh native ESM process`, () => {
    const url = new URL(`../${entry.import}`, import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)})`], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
  });
}

test("built SDK and snapshot helpers initialize together without preloading value modules", () => {
  const entry = name => JSON.stringify(new URL(`../dist/${name}.js`, import.meta.url).href);
  const source = `
    import { run } from ${entry("index")};
    import { serializeSafeJSSnapshot } from ${entry("snapshot/dump-format")};
    import { restore } from ${entry("restore")};
    if ([run, serializeSafeJSSnapshot, restore].some(value => typeof value !== "function")) throw new Error("Missing exports");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

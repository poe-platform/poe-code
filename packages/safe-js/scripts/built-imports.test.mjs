import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";

test("Workerd public entry bundles without native filesystem authority", async () => {
  const result = await build({
    entryPoints: [new URL("../dist/workerd.js", import.meta.url).pathname],
    bundle: true, platform: "neutral", format: "esm", conditions: ["workerd"],
    external: ["node:*"], write: false, metafile: true
  });
  assert.ok(result.outputFiles.length > 0);
  assert.equal(Object.keys(result.metafile.inputs).some(name => name.includes("native-seek")), false);
});

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
test("built platform resolution does not add a nested canonical filesystem package scope", () => {
  assert.equal(existsSync(new URL("../dist/package.json", import.meta.url)), false);
});
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

test("built replay-data helpers initialize without preloading the SDK", () => {
  const url = new URL("../dist/snapshot/replay-data.js", import.meta.url).href;
  const source = `const {encodeReplayData,decodeReplayData}=await import(${JSON.stringify(url)});
    if(decodeReplayData(encodeReplayData(7))!==7)throw new Error("Replay data round trip failed");`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as root from "../../src/index.js";
import * as readonly from "../../src/fs/readonly/index.js";
import * as mount from "../../src/fs/mount/index.js";
import * as overlay from "../../src/fs/overlay/index.js";

test("root exposes delivered wrapper constructors and package subpaths", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  for (const [name, module] of Object.entries({ readonly, mount, overlay })) {
    for (const [symbol, value] of Object.entries(module)) {
      assert.equal(root[symbol as keyof typeof root], value);
    }
    assert.deepEqual(manifest.exports[`./fs/${name}`], {
      types: `./dist/fs/${name}/index.d.ts`,
      import: `./dist/fs/${name}/index.js`,
    });
  }
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.equal(root.createStructuredCommands()[0]?.name, "jq");
});

test("root wrapper factories preserve bytes and lower filesystem isolation", async () => {
  const bytes = new Uint8Array([0, 255, 10]);
  const lower = root.createMemoryFileSystem();
  await lower.writeFile("/lower", bytes);
  const readOnly = root.createReadOnlyFileSystem(lower);
  assert.deepEqual(await readOnly.readFile("/lower"), bytes);
  await assert.rejects(readOnly.writeFile("/denied", new Uint8Array()), { code: "EROFS" });
  const mounted = root.createMountFileSystem({ root: root.createMemoryFileSystem(), mounts: { "/mounted": readOnly } });
  assert.deepEqual(await mounted.readFile("/mounted/lower"), bytes);
  const merged = root.createOverlayFileSystem({ upper: root.createMemoryFileSystem(), lower });
  try {
    assert.deepEqual(await merged.readFile("/lower"), bytes);
    await merged.writeFile("/lower", new Uint8Array([1]));
    assert.deepEqual(await lower.readFile("/lower"), bytes);
    assert.deepEqual(await merged.readFile("/lower"), new Uint8Array([1]));
  } finally {
    await merged.cleanup();
  }
});

test("root exposes delivered search, byte, and diff/patch plugins with their definitions", async () => {
  const commands = new root.CommandRegistry();
  const host: root.PluginHost = { commands, use() {}, registerFileSystem() {} };
  for (const plugin of [root.searchCommands(), root.byteCommands(), root.diffPatchCommands()]) await plugin.setup(host);
  const definitions = [...root.createSearchCommands(), ...root.createByteCommands(), ...root.createDiffPatchCommands()];
  assert.deepEqual(commands.list().map(command => command.name), definitions.map(command => command.name));
  for (const name of ["rg", "base64", "diff", "patch"]) assert.equal(typeof commands.get(name)?.execute, "function");
});

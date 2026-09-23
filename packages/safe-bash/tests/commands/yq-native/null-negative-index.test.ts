import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { mikeYqCommands } from "../../../src/commands/yq/mike.js";

for (const fixture of ["payload: null\n", "changed: Independent\n", "payload: []\n"]) {
  for (const index of [-1, -2]) {
    test(`Mike yq rejects index ${index} on ${fixture.trim()}`, async context => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/changed.yaml", Buffer.from(fixture));
      const shell = new Shell({ fs }).use(mikeYqCommands());
      context.after(() => shell.dispose());
      const result = await shell.exec(`yq '.payload[${index}]' changed.yaml`);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `Error: index [${index}] out of range, array size is 0\n`);
      assert.equal(Buffer.from(await fs.readFile("/changed.yaml")).toString(), fixture);
    });
  }
}

for (const [fixture, index, expected] of [
  ["payload: null\n", 0, "null\n"],
  ["changed: Independent\n", 0, "null\n"],
  ["payload: []\n", 0, "null\n"],
  ["payload: [first, last]\n", -1, "last\n"],
  ["payload: [first, last]\n", -2, "first\n"],
  ["payload: [first, last]\n", 0, "first\n"],
  ['payload: {"-1": mapped}\n', -1, "mapped\n"],
] as const) {
  test(`Mike yq preserves index ${index} on ${fixture.trim()}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(mikeYqCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`yq '.payload[${index}]'`, { stdin: fixture });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  });
}

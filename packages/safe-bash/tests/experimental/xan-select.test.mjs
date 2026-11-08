// Source-only XAN coverage: node --import tsx --conditions=poe-code-source --test tests/experimental/xan-select.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.ts";
import { Shell } from "../../src/shell/index.ts";
import { xanCommands } from "../../src/commands/xan/index.ts";

for (const selector of ["0", "1", "name"]) {
  for (const input of ["empty", "-"]) {
    test(`select -n ${selector} accepts empty ${input}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/empty", new Uint8Array());
      const shell = new Shell({ fs }).use(xanCommands());
      const result = await shell.exec(`xan select -n ${selector} ${input}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    });
  }
}

test("empty headerless select publishes an empty output file", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/empty", new Uint8Array());
  await fs.writeFile("/output", new TextEncoder().encode("old\n"));
  const shell = new Shell({ fs }).use(xanCommands());
  const result = await shell.exec("xan select -n name empty -o output");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal((await fs.readFile("/output")).length, 0);
});

for (const [selector, error] of [
  ["1", "Selector index 1 is out of bounds"],
  ["name", "named selector requires headers (not -n)"],
]) {
  test(`select -n ${selector} still rejects missing columns on nonempty input`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/data", new TextEncoder().encode("Ada\n"));
    const shell = new Shell({ fs }).use(xanCommands());
    const result = await shell.exec(`xan select -n ${selector} data`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(error), result.stderr);
  });
}

test("empty input still rejects malformed selector syntax", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(xanCommands());
  const result = await shell.exec("xan select -n 0,,1 -");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.notEqual(result.stderr, "");
});

test("nonempty headerless input still selects existing columns", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data", new TextEncoder().encode("Ada,1\nGrace,2\n"));
  const shell = new Shell({ fs }).use(xanCommands());
  const result = await shell.exec("xan select -n 1 data");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "1\n2\n");
  assert.equal(result.stderr, "");
});

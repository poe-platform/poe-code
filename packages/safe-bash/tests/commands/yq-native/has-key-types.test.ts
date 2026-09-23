import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { mikeYqCommands } from "../../../src/commands/yq/mike.js";

for (const [key, expected] of [
  ['"1"', false], ['"-2"', false], ["1.25", false],
  ["true", false], ["false", false], ["null", false],
  ["1.0", false], ["0", true], ["2", true], ["3", false], ["-2", true],
] as const) {
  test(`Mike yq array has preserves key type: ${key}`, async context => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.yaml", Buffer.from("[owned, second, third]\n"));
    const shell = new Shell({ fs }).use(mikeYqCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`yq 'has(${key})' input.yaml`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${expected}\n`);
  });
}

test("Mike yq array has uses YAML node types through fields and aliases", async context => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(mikeYqCommands());
  context.after(() => shell.dispose());
  for (const [key, expected] of [
    ["1", "true\n"], ["'1'", "false\n"], ["1.0", "false\n"],
    ["1.25", "false\n"], ["true", "false\n"], ["false", "false\n"], ["null", "false\n"],
  ]) {
    await fs.writeFile("/input.yaml", Buffer.from(`items: [&key ${key}, *key, third]\n`));
    const result = await shell.exec("yq '.items | has(.[1])' input.yaml");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  }
});

test("Mike yq has preserves mapping keys and negative integer policy", async context => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(mikeYqCommands());
  context.after(() => shell.dispose());
  for (const [input, expression, expected] of [
    ["[]\n", "has(-2)", "true\n"],
    ["[]\n", "has(0)", "false\n"],
    ["'1': owned\n", 'has("1")', "true\n"],
    ["owned: value\n", 'has("missing")', "false\n"],
  ]) {
    await fs.writeFile("/input.yaml", Buffer.from(input!));
    const result = await shell.exec(`yq '${expression}' input.yaml`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  }
});

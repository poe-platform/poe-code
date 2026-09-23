import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { mikeYqCommands } from "../../../src/commands/yq/mike.js";

test("Mike yq expands all or selected YAML aliases through Shell", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from("base: &independent\n  marker: ChangedOwned\ncopy: *independent\n"));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  context.after(() => shell.dispose());
  for (const [expression, expected] of [
    ["explode(.)", "base:\n  marker: ChangedOwned\ncopy:\n  marker: ChangedOwned\n"],
    ["explode(.copy)", "base: &independent\n  marker: ChangedOwned\ncopy:\n  marker: ChangedOwned\n"],
    ["explode(.copy) | .copy.marker", "ChangedOwned\n"],
  ]) {
    const result = await shell.exec(`yq '${expression}' input.yaml`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  }
});

test("Mike yq explode preserves tags and scalar styles and expands merge keys", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from("base: &owned\n  marker: !owned 'Changed'\ncopy:\n  <<: *owned\n  extra: value\n"));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("yq --yaml-fix-merge-anchor-to-spec 'explode(.)' input.yaml");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "base:\n  marker: !owned 'Changed'\ncopy:\n  marker: !owned 'Changed'\n  extra: value\n");
});

test("Mike yq explode bounds cycles and expansion allocations", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/cycle.yaml", Buffer.from("base: &owned\n  copy: *owned\n"));
  await fs.writeFile("/input.yaml", Buffer.from("base: &owned [one, two, three]\ncopy: *owned\n"));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  const limited = new Shell({ fs }).use(mikeYqCommands({ limits: { maxNodes: 20 } }));
  context.after(async () => { await shell.dispose(); await limited.dispose(); });
  const cycle = await shell.exec("yq 'explode(.)' cycle.yaml");
  assert.equal(cycle.exitCode, 1);
  assert.match(cycle.stderr, /cyclic YAML alias/);
  const quota = await limited.exec("yq 'explode(.)' input.yaml");
  assert.equal(quota.exitCode, 1);
  assert.match(quota.stderr, /maxNodes/);
});

test("Mike yq explode retains complex and differently typed merge-map keys", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from('base: &owned {x: 1}\ncopy:\n  <<: *owned\n  true: boolean\n  "true": string\n  ? [a, b]\n  : kept\n'));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("yq --yaml-fix-merge-anchor-to-spec 'explode(.)' input.yaml");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, 'base: {x: 1}\ncopy:\n  x: 1\n  true: boolean\n  "true": string\n  ? [a, b]\n  : kept\n');
});

test("Mike yq explode retains nested alias comments", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from('base: &owned\n  marker: "Changed" # source\n# copied head\ncopy: *owned # copied inline\n'));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  context.after(() => shell.dispose());
  for (const expression of ["explode(.)", "explode(.copy)"]) {
    const result = await shell.exec(`yq '${expression}' input.yaml`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /# copied inline/);
    assert.match(result.stdout, /# copied head/);
    assert.match(result.stdout, /marker: "Changed" # source/);
  }
});

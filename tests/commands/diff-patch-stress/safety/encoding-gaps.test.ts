import assert from "node:assert/strict";
import test from "node:test";
import { assertBytes, cwd, instrument, invoke, memory, snapshot } from "./helpers.js";

for (const [name, encoded] of [
  ["café.txt", "caf\\303\\251.txt"],
  ['quote"name.txt', 'quote\\"name.txt'],
] as const) {
  test(`COMMON-FLOW GAP: safely decoded Git-quoted filename ${JSON.stringify(name)} updates exactly that inode`, async () => {
    const backing = await memory({ [name]: "old\n", sentinel: "untouched\n" });
    const before = await snapshot(backing);
    const identity = (await backing.lstat(`${cwd}/${name}`)).ino;
    const observed = instrument(backing);
    const input = `diff --git "a/${encoded}" "b/${encoded}"\nindex 3367afd..3e75765 100644\n--- "a/${encoded}"\n+++ "b/${encoded}"\n@@ -1 +1 @@\n-old\n+new\n`;
    const result = await invoke(observed.fs, "patch", { args: ["-p1"], input });
    if (result.exitCode !== 0) {
      assert.deepEqual(observed.mutations(), []);
      assert.deepEqual(await snapshot(backing), before);
    }
    await assertBytes(backing, "sentinel", "untouched\n");
    assert.equal(result.exitCode, 0, `Common safe input must apply, not merely reject safely: ${result.stderr}`);
    await assertBytes(backing, name, "new\n");
    assert.equal((await backing.lstat(`${cwd}/${name}`)).ino, identity);
    assert.deepEqual(observed.mutations().map(call => call.path), [`${cwd}/${name}`]);
  });
}

for (const encoded of ["a/\\056\\056/target", "\\057sandbox/work/target", "a/target\\000suffix", "a/target\\q", "a/target\\777"]) {
  test(`quoted unsafe/invalid encoding remains non-mutating: ${encoded}`, async () => {
    const backing = await memory();
    const before = await snapshot(backing);
    const observed = instrument(backing);
    const input = `--- "${encoded}"\n+++ "${encoded}"\n@@ -1 +1 @@\n-old\n+new\n`;
    const result = await invoke(observed.fs, "patch", { args: ["-p1"], input });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.deepEqual(observed.mutations(), []);
    assert.deepEqual(await snapshot(backing), before);
  });
}

test("COMMON-FLOW GAP: adjacent slash strip handles a safe relative target", async () => {
  const backing = await memory({ target: "old\n", sentinel: "untouched\n" });
  const before = await snapshot(backing);
  const identity = (await backing.lstat(`${cwd}/target`)).ino;
  const observed = instrument(backing);
  const input = "--- a//target\n+++ b//target\n@@ -1 +1 @@\n-old\n+new\n";
  const result = await invoke(observed.fs, "patch", { args: ["-p1"], input });
  if (result.exitCode !== 0) {
    assert.deepEqual(observed.mutations(), []);
    assert.deepEqual(await snapshot(backing), before);
  }
  await assertBytes(backing, "sentinel", "untouched\n");
  assert.equal(result.exitCode, 0, `Safe adjacent slash strip must apply: ${result.stderr}`);
  await assertBytes(backing, "target", "new\n");
  assert.equal((await backing.lstat(`${cwd}/target`)).ino, identity);
  assert.deepEqual(observed.mutations().map(call => call.path), [`${cwd}/target`]);
});

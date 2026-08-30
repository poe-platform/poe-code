import assert from "node:assert/strict";
import test from "node:test";
import type { DiffPatchOptions } from "../../../../src/commands/diff-patch/index.js";
import { assertBytes, bytes, cwd, instrument, invoke, memory, replacement, snapshot } from "./helpers.js";

for (const [name, invalid] of [
  ["unsafe integer", "@@ -9007199254740992 +1 @@\n-old\n+new\n"],
  ["overflow count", "@@ -1,9007199254740992 +1 @@\n-old\n+new\n"],
  ["negative count", "@@ -1,-1 +1 @@\n-old\n+new\n"],
  ["zero count changes", "@@ -0,0 +0,0 @@\n"],
  ["repeated old header", "--- second\n@@ -1 +1 @@\n-old\n+new\n"],
  ["new header without body", ""],
  ["truncated hunk", "@@ -1 +1 @@\n-old\n"],
  ["extra deletion", "@@ -1 +1 @@\n-old\n+new\n-old\n"],
  ["huge coordinate", "@@ -999999999 +999999999 @@\n-old\n+new\n"],
  ["repeated newline marker", "@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n\\ No newline at end of file\n"],
] as const) test(`atomic extension malformed later section ${name} cannot partially commit`, async () => {
  const backing = await memory({ first: "old\n", second: "old\n" });
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { args: ["--atomic"], input: replacement("first") + `--- second\n+++ second\n${invalid}` });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal(result.stdout, "");
  assert.deepEqual(observed.mutations(), []);
  assert.deepEqual(await snapshot(backing), before);
});

for (const [name, options] of [
  ["aggregate input", { maxInputBytes: 20 }], ["aggregate output", { maxOutputBytes: 25 }],
  ["aggregate lines", { maxLines: 8 }], ["file count", { maxFiles: 1 }],
  ["hunk count", { maxHunks: 1 }], ["work", { maxWork: 5 }],
] satisfies [string, DiffPatchOptions][]) test(`atomic extension ${name} budget failure during preparation leaves targets unchanged`, async () => {
  const backing = await memory({ first: "old\n", second: "old\n" });
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { args: ["--atomic"], input: replacement("first") + replacement("second"), options });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal(result.stdout, "");
  assert.deepEqual(observed.mutations(), []);
  assert.deepEqual(await snapshot(backing), before);
});

test("atomic extension recheck input bytes are charged before any commit", async () => {
  const backing = await memory({ first: "old\n", second: "old\n" });
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const input = replacement("first") + replacement("second");
  const result = await invoke(observed.fs, "patch", { args: ["--atomic"], input, options: { maxInputBytes: Buffer.byteLength(input) + 8 } });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.deepEqual(observed.mutations(), []);
  assert.deepEqual(await snapshot(backing), before);
});

test("repeated headers hit the section budget before any target read", async () => {
  const backing = await memory();
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { input: replacement().repeat(128), options: { maxFiles: 16 } });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /file\/entry limit/u);
  assert.deepEqual(observed.calls, []);
  await assertBytes(backing, "target", "old\n");
});

for (const invalid of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid configured limit ${String(invalid)} has no filesystem effects`, async () => {
    const backing = await memory();
    for (const option of ["maxInputBytes", "maxOutputBytes", "maxLines", "maxFiles", "maxHunks", "maxWork", "maxMatrixCells"] as const) {
      const observed = instrument(backing);
      const result = await invoke(observed.fs, "patch", { input: replacement(), options: { [option]: invalid } });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.deepEqual(observed.calls, []);
    }
  });
}

test("atomic extension bounded work-limit sweep covers preflight, partial-commit and success states", { timeout: 10000 }, async () => {
  const states = new Set<string>();
  for (let limit = 1; limit <= 512; limit++) {
    const backing = await memory({ first: "old\n", second: "old\n", third: "old\n" });
    const observed = instrument(backing);
    const result = await invoke(observed.fs, "patch", { args: ["--atomic"], input: replacement("first") + replacement("second") + replacement("third"), options: { maxWork: limit } });
    const writes = observed.mutations();
    assert.deepEqual(writes.map(call => call.path), ["first", "second", "third"].slice(0, writes.length).map(name => `${cwd}/${name}`));
    for (const [index, name] of ["first", "second", "third"].entries()) await assertBytes(backing, name, index < writes.length ? "new\n" : "old\n");
    if (result.exitCode === 0) { assert.equal(writes.length, 3); states.add("success"); }
    else {
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal(result.stdout, "");
      if (writes.length) {
        states.add("partial");
        assert.match(result.stderr, new RegExp(`${writes.length}/3 files committed`));
      } else states.add("preflight");
    }
  }
  assert.deepEqual([...states].sort(), ["partial", "preflight", "success"]);
});

for (const input of [bytes("bad\0text\n"), new Uint8Array([0xff, 0xfe, 0x0a])]) {
  test(`atomic extension binary later target ${Buffer.from(input).toString("hex")} cannot cause an earlier write`, async () => {
    const backing = await memory({ first: "old\n", second: input });
    const before = await snapshot(backing);
    const observed = instrument(backing);
    const result = await invoke(observed.fs, "patch", { args: ["--atomic"], input: replacement("first") + replacement("second") });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /binary input/u);
    assert.deepEqual(observed.mutations(), []);
    assert.deepEqual(await snapshot(backing), before);
  });
}

test("overlong paths fail before any stat, read or write of their target", async () => {
  const backing = await memory();
  for (const name of ["segment/".repeat(257) + "target", "x".repeat(4097)]) {
    const observed = instrument(backing);
    const result = await invoke(observed.fs, "patch", { input: replacement(name) });
    assert.equal(result.exitCode, 2);
    assert.deepEqual(observed.calls, []);
    assert(Buffer.byteLength(result.stderr) < 4096);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { compareNative, runVirtual } from "./helpers.js";

for (const [name, args, stdin, files] of [
  ["read after automatic output", ["1r extra"], "a\nb\n", { extra: "extra\n" }],
  ["read queues at cycle end", ["1r extra\np"], "a\nb\n", { extra: "raw" }],
  ["read flushes after delete", ["r extra\nd"], "a\n", { extra: "extra\n" }],
  ["read and append retain order", ["r extra\na\\\nappend\nr missing"], "a\n", { extra: "extra\n" }],
  ["read is observed after write", ["r output\nw output"], "a\nb\n", { output: "old\n" }],
  ["write selected records", ["-n", "2,3w output"], "a\nb\nc\nd\n", { output: "old\n" }],
  ["write precreates without input", ["-n", "2w output"], "", { output: "old\n" }],
  ["write across multiple files", ["-n", "w output", "first", "last"], "", { first: "a\n", last: "b\n" }],
  ["substitution conditional write", ["s/a/A/w output"], "a\nb\n", {}],
  ["write filename with spaces", ["w output name"], "abc", {}],
] as const) {
  test(`sed file command: ${name}`, async () => {
    await compareNative("sed", { args: [...args], stdin, files });
  });
}

test("file command syntax failure preserves input and existing output", async () => {
  const actual = await runVirtual("sed", { args: ["w output\n?"], stdin: "input\n", files: { output: "keep\n" } });
  assert.notEqual(actual.exitCode, 0);
  assert.equal(actual.files.output?.toString(), "keep\n");
});

test("read command preserves raw bytes and has bounded append queues", async () => {
  const raw = Buffer.from([0, 255, 10, 128]);
  const actual = await runVirtual("sed", { args: ["-n", "r raw"], stdin: "trigger\n", files: { raw } });
  assert.equal(actual.exitCode, 0, actual.stderr.toString());
  assert.deepEqual(actual.stdout, raw);
  const bounded = await runVirtual("sed", { args: [":loop\nr raw\nb loop"], stdin: "trigger\n", files: { raw } }, { maxBufferBytes: 128 });
  assert.notEqual(bounded.exitCode, 0);
  assert.match(bounded.stderr.toString(), /buffer limit/u);
});

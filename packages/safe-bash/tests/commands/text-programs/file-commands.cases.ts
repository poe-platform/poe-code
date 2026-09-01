import assert from "node:assert/strict";
import test from "node:test";
import { runVirtual } from "./helpers.js";

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

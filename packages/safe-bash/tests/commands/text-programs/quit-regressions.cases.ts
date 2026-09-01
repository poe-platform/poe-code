import assert from "node:assert/strict";
import test from "node:test";
import { runVirtual } from "./helpers.js";

for (const program of ["1q", "1q 0"]) {
  test(`successful ${program} stops the invocation without editing later files`, async () => {
    const actual = await runVirtual("sed", { args: ["-i.bak", program, "first", "last"], files: { first: "a\nb\n", last: "c\nd\n" } });
    assert.equal(actual.exitCode, 0, actual.stderr.toString());
    assert.deepEqual(actual.files, { first: Buffer.from("a\n"), "first.bak": Buffer.from("a\nb\n"), last: Buffer.from("c\nd\n") });
    assert.equal(actual.stdout.length, 0);
  });
}

test("quiet in-place quit truncates only the file explicitly processed", async () => {
  const actual = await runVirtual("sed", { args: ["-ni.bak", "1q", "first", "last"], files: { first: "a\nb\n", last: "c\nd\n" } });
  assert.equal(actual.exitCode, 0);
  assert.deepEqual(actual.files, { first: Buffer.alloc(0), "first.bak": Buffer.from("a\nb\n"), last: Buffer.from("c\nd\n") });
});

test("separate-file addressing does not turn quit into per-file continuation", async () => {
  const actual = await runVirtual("sed", { args: ["-s", "1q", "first", "last"], files: { first: "a\nb\n", last: "c\nd\n" } });
  assert.equal(actual.exitCode, 0);
  assert.equal(actual.stdout.toString(), "a\n");
});

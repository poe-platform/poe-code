import assert from "node:assert/strict";
import test from "node:test";
import { contents, replacement, run } from "./helpers.test.js";
import { StoredPatchInput } from "./stored-input.js";

for (const args of [[], ["--atomic"]]) {
  test(`description before the first file header applies with -p0 ${args}`, async () => {
    const result = await run("patch", [...args, "-p0"], {
      files: { f: "a\n" }, input: "Fix f\n\n--- f\n+++ f\n@@ -1 +1 @@\n-a\n+b\n",
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "patching file f\n");
    assert.equal(result.stderr, "");
    assert.equal(await contents(result.fs, "f"), "b\n");
  });

  test(`recursive diff Only in preamble applies with -p1 ${args}`, async () => {
    const result = await run("patch", [...args, "-p1"], {
      files: { f: "b\n" },
      input: "Only in x: y\ndiff -ru x/f y/f\n--- x/f\t2020-01-01\n+++ y/f\t2020-01-01\n@@ -1 +1 @@\n-b\n+c\n",
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "patching file f\n");
    assert.equal(result.stderr, "");
    assert.equal(await contents(result.fs, "f"), "c\n");
  });
}

test("CRLF description preserves Index headers", async () => {
  const result = await run("patch", [], {
    files: { target: "old\n" },
    input: "Fix target\nIndex: target\n========\n1c1\n< old\n---\n> new\n".replaceAll("\n", "\r\n"),
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "new\n");
});

for (const input of ["Just a description\n\n", `Fix target\n${replacement.replace("+new\n", "")}`,
  `Fix target\ndiff --git a/target b/target\nrename from target\nrename to other\n${replacement}`]) {
  test(`preamble does not hide missing or invalid patch data ${JSON.stringify(input)}`, async () => {
    const result = await run("patch", [], { files: { target: "old\n" }, input });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(await contents(result.fs, "target"), "old\n");
  });
}

test("description lines count toward the patch line limit", async () => {
  const result = await run("patch", [], {
    files: { target: "old\n" }, input: "description\n".repeat(20) + replacement, options: { maxLines: 20 },
  });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal(await contents(result.fs, "target"), "old\n");
});

test("long descriptions are skipped without decoding full lines", async t => {
  const read = StoredPatchInput.prototype.read;
  t.mock.method(StoredPatchInput.prototype, "read", async function(this: StoredPatchInput, index: number, prefix?: number) {
    if (index >= 0 && index < this.length) {
      const line = await this.document.line(this.start + index);
      if (line.end - line.start > 16384) assert.ok(prefix !== undefined && prefix <= 128);
    }
    return Reflect.apply(read, this, [index, prefix]);
  });
  const result = await run("patch", [], {
    files: { target: "old\n" }, input: "description ".repeat(16384) + "\n" + replacement,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "new\n");
});

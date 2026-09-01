import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, run } from "./helpers.js";

const cases = [
  { name: "replacement", old: "a\nb\nc\n", next: "a\nB\nc\n" },
  { name: "insertion", old: "a\nc\n", next: "a\nb\nc\n" },
  { name: "deletion", old: "a\nb\nc\n", next: "a\nc\n" },
  { name: "empty old", old: "", next: "one\ntwo\n" },
  { name: "empty new", old: "one\ntwo\n", next: "" },
  { name: "unterminated old", old: "one", next: "one\n" },
  { name: "unterminated new", old: "one\n", next: "one" },
  { name: "unterminated both", old: "old", next: "new" },
  { name: "CRLF", old: "one\r\ntwo\r\n", next: "ONE\r\ntwo\r\n" },
  { name: "UTF-8 BOM", old: "\ufeffcafé\n雪\n", next: "\ufeffcafe\n雪☃\n" },
  { name: "separate hunks", old: "0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n", next: "X\n1\n2\n3\n4\n5\n6\n7\n8\nY\n" },
];

for (const fixture of cases) for (const context of [0, 3]) {
  test(`native diff exact output and cross-apply: ${fixture.name}, U${context}`, async () => {
    const args = [`-U${context}`, "--label", "old", "--label", "new", "old", "new"];
    const files = { old: fixture.old, new: fixture.next };
    const actual = await run("diff", args, { files });
    assert.equal(actual.stderr, "");
    const applied = await run("patch", ["old"], { files, input: actual.stdout });
    assert.equal(applied.exitCode, 0, applied.stderr);
    assert.equal(await contents(applied.fs, "old"), fixture.next);
  });
}

test("identical input returns zero without headers", async () => {
  const result = await run("diff", ["old", "new"], { files: { old: "same\n", new: "same\n" } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
});

test("brief comparison, grouped flags, and stdin operands", async () => {
  const result = await run("diff", ["-uq", "-", "new"], { files: { new: "new\n" }, input: "old\n" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "Files - and new differ\n");
  const same = await run("diff", ["-", "-"], { input: "identical\n" });
  assert.equal(same.exitCode, 0);
});

test("recursive new-file diffs create, delete, and update with strip", async () => {
  const files = { "before/common": "old\n", "before/gone": "gone\n", "after/common": "new\n", "after/fresh": "fresh\n" };
  const diff = await run("diff", ["-urN", "before", "after"], { files });
  assert.equal(diff.exitCode, 1, diff.stderr);
  assert.match(diff.stdout, /--- \/dev\/null\n\+\+\+ after\/fresh/u);
  assert.match(diff.stdout, /--- before\/gone\n\+\+\+ \/dev\/null/u);
  const patched = await run("patch", ["-p1"], { files: { common: "old\n", gone: "gone\n" }, input: diff.stdout });
  assert.equal(patched.exitCode, 0, patched.stderr);
  assert.equal(await contents(patched.fs, "common"), "new\n");
  assert.equal(await contents(patched.fs, "fresh"), "fresh\n");
  await assert.rejects(patched.fs.stat("/work/gone"));
});

test("recursive order is deterministic and nonrecursive subdirectories stay unvisited", async () => {
  const files = { "left/z": "z\n", "left/a": "a\n", "left/sub/item": "old\n", "right/sub/item": "new\n" };
  const result = await run("diff", ["left", "right"], { files });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "Only in left: a\nCommon subdirectories: left/sub and right/sub\nOnly in left: z\n");
});

test("file-directory matching uses the file basename", async () => {
  const result = await run("diff", ["-u", "file", "directory"], { files: { file: "old\n", "directory/file": "new\n" } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /\+\+\+ directory\/file/u);
});

test("literal option-like filenames and labels with spaces", async () => {
  const result = await run("diff", ["-U", "1", "-L", "old name", "--label=new name", "--", "-old", "-new"], { files: { "-old": "old\n", "-new": "new\n" } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /^--- old name\n\+\+\+ new name\n/u);
});

for (const args of [["-x", "a", "b"], ["--color", "a", "b"], ["-U-1", "a", "b"], ["-U"], ["a"], ["--label=a\nb", "a", "b"]]) {
  test(`diff rejects invalid arguments ${JSON.stringify(args)}`, async () => {
    const result = await run("diff", args, { files: { a: "a", b: "b" } });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  });
}

test("GNU unified accepts context above the safe integer range with exact incomplete-line output", async () => {
  const files = { a: "a", b: "b" };
  const args = ["-U9007199254740992", "-L", "a", "-L", "b", "a", "b"];
  const expected = { exitCode: 1, stdout: "--- a\n+++ b\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n", stderr: "" };
  for (const actual of [await run("diff", args, { files })]) {
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, expected);
  }
});

test("missing paths require -N; both missing remains an error", async () => {
  assert.equal((await run("diff", ["missing", "present"], { files: { present: "x" } })).exitCode, 2);
  assert.equal((await run("diff", ["-N", "missing", "also-missing"])).exitCode, 2);
});

test("symlinks including ancestors are rejected without dereferencing", async () => {
  const fs = await filesystem({ target: "old", "dir/item": "new" });
  await fs.symlink("target", "/work/link");
  await fs.symlink("dir", "/work/alias");
  for (const path of ["link", "alias/item"]) {
    const result = await run("diff", [path, "target"], { fs });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /symlink/u);
  }
});

test("bounded seeded repeated-line diffs roundtrip in both directions", async () => {
  let seed = 0x124578;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let sample = 0; sample < 100; sample++) {
    const make = () => Array.from({ length: random() % 20 }, () => `${random() % 5}\n`).join("").replace(/\n$/u, random() % 2 ? "\n" : "");
    const old = make();
    const next = make();
    const diff = await run("diff", [`-U${sample % 5}`, "--label=target", "--label=target", "old", "new"], { files: { old, new: next } });
    assert.equal(diff.exitCode, old === next ? 0 : 1, diff.stderr);
    const fs = await filesystem({ target: old });
    const applied = await run("patch", [], { fs, input: diff.stdout });
    assert.equal(applied.exitCode, 0, `sample ${sample}: ${applied.stderr}\n${diff.stdout}`);
    assert.equal(await contents(fs, "target"), next);
    const reversed = await run("patch", ["-R"], { fs, input: diff.stdout });
    assert.equal(reversed.exitCode, 0, reversed.stderr);
    assert.equal(await contents(fs, "target"), old);
  }
});

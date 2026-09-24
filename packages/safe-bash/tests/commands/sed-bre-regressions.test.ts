import assert from "node:assert/strict";
import test from "node:test";
import { runVirtual } from "./text-programs/helpers.js";

for (const [program, input, expected] of [
  ["s/*foo/bar/", "*foo\n", "bar\n"],
  ["s/^*foo/bar/", "*foo\n", "bar\n"],
  ["s/\\(*foo\\)/[\\1]/", "*foo\n", "[*foo]\n"],
  ["s/a^b/ok/", "a^b\n", "ok\n"],
  ["s/a$b/ok/", "a$b\n", "ok\n"],
  ["s/^^foo/ok/", "^foo\n", "ok\n"],
  ["s/^foo/bar/", "xfoo\nfoo\n", "xfoo\nbar\n"],
  ["s/foo$/bar/", "foox\nfoo\n", "foox\nbar\n"],
  ["s/\\(^foo$\\)/ok/", "foo\n", "ok\n"],
  ["s/b/[\\0]/", "abc\n", "a[b]c\n"],
  ["s/ab/\\0\\0/g", "abab\n", "abababab\n"],
  ["0,/foo/s/foo/bar/", "foo\nfoo\n", "bar\nfoo\n"],
  ["0,/foo/s/o/O/g", "other\nfoo\nfoo\n", "Other\nfOO\nfoo\n"],
  ["0,/missing/s/o/O/g", "other\nfoo\n", "Other\nfOO\n"],
  ["1,/foo/s/foo/bar/", "foo\nfoo\nfoo\n", "bar\nbar\nfoo\n"],
  ["p # comment", "x\n", "x\nx\n"],
  ["s/x/y/ # comment", "x\n", "y\n"],
] as const) {
  test(`sed regression ${program}`, async () => {
    const result = await runVirtual("sed", { args: [program], stdin: input });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), expected);
    assert.equal(result.stderr.length, 0);
  });
}

for (const program of ["0p", "0,1p", "1,0p"]) {
  test(`sed rejects invalid zero address ${program}`, async () => {
    const result = await runVirtual("sed", { args: [program], stdin: "x\n" });
    assert.equal(result.exitCode, 2);
  });
}

test("sed admits whole-match replacement size before writing", async () => {
  const result = await runVirtual("sed", { args: ["s/.*/\\0\\0/"], stdin: "abcd\n" }, { maxBufferBytes: 6 });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout.length, 0);
});

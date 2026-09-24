import assert from "node:assert/strict";
import test from "node:test";
import { runVirtual } from "./text-programs/helpers.js";

for (const [program, input, expected] of [
  ["s/[/]/:/", "a/b\n", "a:b\n"],
  ["/[/]/p", "a/b\n", "a/b\na/b\n"],
  ["s/[]/]/X/g", "]/\n", "XX\n"],
  ["s/[^]/]/X/g", "]/a\n", "]/X\n"],
  ["s/[[:punct:]/]/X/g", "/!a\n", "XXa\n"],
  ["s:[[:alpha:]:]:X:g", "a:b\n", "XXX\n"],
  ["s|a\\|b|X|", "a\na|b\n", "a\nX\n"],
  ["s+a\\+b+X+", "aab\na+b\n", "aab\nX\n"],
  ["s?a\\?b?X?", "ab\na?b\n", "ab\nX\n"],
  ["s.a\\.b.X.", "axb\na.b\n", "axb\nX\n"],
  ["s|[a\\|]|X|g", "a|b\n", "XXb\n"],
  ["\\|a\\|b|p", "a\na|b\n", "a\na|b\na|b\n"],
  ["\\+a\\+b+p", "aab\na+b\n", "aab\na+b\na+b\n"],
  ["\\?a\\?b?p", "ab\na?b\n", "ab\na?b\na?b\n"],
  [":1; s/a/b/; t 1", "aaa\n", "bbb\n"],
  ["b 1end; s/a/b/; :1end", "a\n", "a\n"],
  ["1i\\world", "hello\n", "world\nhello\n"],
  ["1a\\world", "hello\n", "hello\nworld\n"],
  ["1c\\world", "hello\n", "world\n"],
  ["1i\\\nworld", "hello\n", "world\nhello\n"],
  ["s/x/[/", "x\n", "[\n"],
  ["y/[/]/", "[\n", "]\n"],
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

for (const delimiter of ["|", "+", "?"]) {
  test(`sed ERE escaped delimiter ${delimiter} stays literal`, async () => {
    const result = await runVirtual("sed", { args: ["-E", `s${delimiter}a\\${delimiter}b${delimiter}X${delimiter}`], stdin: `aab\na${delimiter}b\n` });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), "aab\nX\n");
  });
}

for (const program of ["s.[[.a.]/].X.", "s=[[=a=]/]=X="]) {
  test(`sed scans special bracket delimiters before regex validation ${program}`, async () => {
    const result = await runVirtual("sed", { args: [program], stdin: "a/b\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.toString(), "sed: collating and equivalence classes are not supported\n");
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

import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSedCommand, type SedCommandsOptions } from "./index.js";

async function runSed(fixture: { args: string[]; stdin: string }, options: SedCommandsOptions = {}) {
  const values = createCommandArguments(fixture.args);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createSedCommand(options).execute({
    command: "sed", args: values.args, argumentValues: values,
    cwd: "/", env: { LC_ALL: "C", LANG: "C", TZ: "UTC" }, fs: createMemoryFileSystem(),
    stdin: toByteSource(fixture.stdin), signal: new AbortController().signal,
    stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

for (const [program, input, expected] of [
  ["s/\\x3a/-/", "a:b\n", "a-b\n"],
  ["s/a/\\x41\\o102\\d067/", "a\n", "ABC\n"],
  ["s/[\\x20]/_/", "a b\n", "a_b\n"],
  ["s/$/\\x0d/", "a\n", "a\r\n"],
  ["s/b/\\cA/", "abc\n", "a\x01c\n"],
  ["s/\\x0d$//", "a\r\n", "a\n"],
  ["s/\\x09/_/", "a\tb\n", "a_b\n"],
  ["s/[\\o101\\d066\\cC]/_/g", "AB\x03\n", "___\n"],
  ["/\\x41/p", "A\nB\n", "A\nA\nB\n"],
  ["s/\\o101\\d066\\cC/_/", "AB\x03\n", "_\n"],
  ["s/a/\\x26\\x5c1/", "a\n", "&\\1\n"],
  ["s/a/\\\\x41/", "a\n", "\\x41\n"],
  ["s/\\\\x41/_/", "\\x41\n", "_\n"],
  ["s/a/\\x4a2\\o1012\\d0652/", "a\n", "J2A2A2\n"],
  ["s/a/\\xZ\\o8\\dZ/", "a\n", "xZo8dZ\n"],
  ["s/a/\\ca/", "a\n", "\x01\n"],
  ["s/a/\\U\\x61/", "a\n", "A\n"],
  ["s/\\x2e/_/g", "ab\n", "__\n"],
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
    const result = await runSed({ args: [program], stdin: input });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), expected);
    assert.equal(result.stderr.length, 0);
  });
}

for (const delimiter of ["|", "+", "?"]) {
  test(`sed ERE escaped delimiter ${delimiter} stays literal`, async () => {
    const result = await runSed({ args: ["-E", `s${delimiter}a\\${delimiter}b${delimiter}X${delimiter}`], stdin: `aab\na${delimiter}b\n` });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), "aab\nX\n");
  });
}

for (const program of ["s.[[.a.]/].X.", "s=[[=a=]/]=X="]) {
  test(`sed scans special bracket delimiters before regex validation ${program}`, async () => {
    const result = await runSed({ args: [program], stdin: "a/b\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.toString(), "sed: collating and equivalence classes are not supported\n");
  });
}

for (const program of ["0p", "0,1p", "1,0p"]) {
  test(`sed rejects invalid zero address ${program}`, async () => {
    const result = await runSed({ args: [program], stdin: "x\n" });
    assert.equal(result.exitCode, 2);
  });
}

test("sed admits whole-match replacement size before writing", async () => {
  const result = await runSed({ args: ["s/.*/\\0\\0/"], stdin: "abcd\n" }, { maxBufferBytes: 6 });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout.length, 0);
});

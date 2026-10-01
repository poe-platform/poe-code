import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";
import { spawnSync } from "node:child_process";

test('speculative search awaits a due yield before retrying', async () => {
 const fs = createMemoryFileSystem();
 await fs.mkdir('/files');
 await fs.writeFile('/files/a', new TextEncoder().encode('ab\n'.repeat(2050)));
 const values = createCommandArguments(['-v', '-c', 'zz', '/files']);
 const controller = new AbortController();
 let output = '';
 const context = {
  command: 'rg', args: values.args, argumentValues: values, cwd: '/', env: {}, fs,
  stdin: toByteSource(''), signal: controller.signal,
  _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true,
  stdout: {
   _scratch4k: new Uint8Array(4096),
   writeRangeSync(bytes: Uint8Array, start: number, end: number) { output += new TextDecoder().decode(bytes.subarray(start, end)); },
   async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); },
  },
  stderr: { async write() {} },
 };
 const pending = createRgCommand().execute(context);
 const reason = new Error('cancel speculative yield');
 const rejected = assert.rejects(Promise.resolve(pending), error => error === reason);
 controller.abort(reason);
 await rejected;
 assert.equal(output, '');
});

const replacementCases: readonly [readonly string[], string, string][] = [
  [["foo (123)", "-r", "$1"], "foo 123 bar\n", "123 bar\n"],
  [["(a)(b)", "-r", "$0:$1:${2}:$$:$missing:$9"], "ab\n", "ab:a:b:$::\n"],
  [["(?P<word>foo) (?<digits>[0-9]+)", "--replace", "${digits}/$word"], "foo 123\n", "123/foo\n"],
  [["(a)", "-r", "$1suffix/${1}suffix/$01/$/$-/$$1/${}/$100"], "a\n", "/asuffix/a/$/$-/$1/${}/\n"],
  [["(?:x)(a)?(b)", "-r", "<$1,$2>"], "xb xab\n", "<,b> <a,b>\n"],
  [["((a)?b)+", "-r", "$1/$2"], "abb\n", "b/a\n"],
  [["(a+?)(a*)", "-r", "$1/$2"], "aaa\n", "a/aa\n"],
  [["-e", "(a)", "-e", "(b)", "-r", "[$1:$2]"], "ab\n", "[a:][:b]\n"],
  [["(é)(🦊)", "-r", "$2$1", "-nbo"], "xé🦊 é🦊\n", "1:1:🦊é\n1:8:🦊é\n"],
  [["-F", "a+b", "-r", "$0/$$/$1"], "a+b\n", "a+b/$/\n"],
  [["()", "-r", "[$1]"], "ab\n", "[]a[]b[]\n"],
  [["(foo)", "-r", "$1$1", "-C1"], "before\nfoo\nafter\n", "before\nfoofoo\nafter\n"],
  [["(foo)", "-r", "$1", "--crlf", "-o"], "foo\r\n", "foo\r\n"],
  [["(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)", "-r", "$10/${9}/$8/$7/$6/$5/$4/$3/$2/$1"], "abcdefghij\n", "j/i/h/g/f/e/d/c/b/a\n"],
  [["(?<__proto__>a)(?<constructor>b)", "-r", "$__proto__/$constructor"], "ab\n", "a/b\n"],
];

for (const [args, input, expected] of replacementCases) test(`rg expands replacement captures: ${JSON.stringify(args)}`, async () => {
 const values = createCommandArguments([...args, "-"]);
 let stdout = "", stderr = "";
 const result = await createRgCommand().execute({
  command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(input),
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, stderr);
 assert.equal(stderr, "");
 assert.equal(stdout, expected);
 if (process.env.SAFE_BASH_TEST_RG === "1") {
  const native = spawnSync("rg", ["--no-config", ...args, "-"], { input, encoding: "utf8", timeout: 3000 });
  assert.ifError(native.error);
  assert.deepEqual({ stdout, stderr, status: result.exitCode }, { stdout: native.stdout, stderr: native.stderr, status: native.status });
 }
});

test("rg capture expansion enforces output byte limits and permits shrinking replacements", async () => {
 for (const [args, input, limit, code, expected] of [
  [["(a+)", "-r", "$1$1"], "aaaaaaaa\n", 10, 2, ""],
  [["(a+)", "-or", "$1$1"], "aaaaaaaa\n", 10, 2, ""],
  [["(é)", "-r", "$1$1"], "é\n", 4, 2, ""],
  [["(é)", "-r", "$1$1"], "é\n", 5, 0, "éé\n"],
  [["a+", "-r", "$missing"], "aaaaaaaa\n", 1, 0, "\n"],
 ] as const) {
  const values = createCommandArguments([...args, "-"]);
  let stdout = "", stderr = "";
  const result = await createRgCommand({ maxOutputBytes: limit }).execute({
   command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {},
   fs: createMemoryFileSystem(), stdin: toByteSource(input),
   stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, code, stderr);
  assert.equal(stdout, expected);
  if (code === 2) assert.match(stderr, /output byte limit exceeded/);
  else assert.equal(stderr, "");
 }
});

test("rg help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createRgCommand().execute({
  command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

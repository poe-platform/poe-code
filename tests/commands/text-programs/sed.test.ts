import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { byteChunks, compareNative, makeFileSystem, runVirtual, type OracleCase } from "./helpers.js";

const cases: Record<string, OracleCase> = {
  "numeric address range": { args: ["-n", "2,3p"], stdin: "one\ntwo\nthree\nfour\n" },
  "regex range includes both endpoints": { args: ["-n", "/start/,/end/p"], stdin: "skip\nstart\nmiddle\nend\nskip\n" },
  "regex range does not end on its starting line": { args: ["-n", "/x/,/x/p"], stdin: "x\na\nx\nb\n" },
  "descending numeric range is one record": { args: ["-n", "3,1p"], stdin: "1\n2\n3\n4\n" },
  "last and negated addresses": { args: ["-n", "$!p"], stdin: "a\nb\nc\n" },
  "substitution and explicit print": { args: ["-n", "s/a/A/gp"], stdin: "banana\npear\nxxx\n" },
  "numbered substitution": { args: ["s/a/X/2"], stdin: "banana\n" },
  "basic capture replacement": { args: ["s/\\([a-z]*\\):\\([0-9]*\\)/\\2-&-\\1/"], stdin: "pear:12\n" },
  "extended captures and leftmost longest alternation": { args: ["-E", "s/(a|ab)/[\\1]/g"], stdin: "ab a\n" },
  "repetition intervals and classes": { args: ["-E", "s/[[:digit:]]{2,3}/#/g"], stdin: "1 12 123 1234\n" },
  "empty substitution matches": { args: ["s/a*/X/g"], stdin: "ab\nzzz\n" },
  "empty regex reuses previous expression": { args: ["/a/s//A/g"], stdin: "banana\npear\n" },
  "alternate delimiter and escaped delimiter": { args: ["s#one/two#three\\#four#"], stdin: "one/two\n" },
  "address groups and deletion": { args: ["2,4{s/a/A/g; /drop/d; p;}"], stdin: "first\na\ndrop\na\nlast\n" },
  "append insert and change": { args: ["-e", "1i\\\nheader", "-e", "2a\\\nafter", "-e", "3c\\\nreplacement"], stdin: "one\ntwo\nthree\n" },
  "change whole range": { args: ["2,4c\\\nchanged"], stdin: "1\n2\n3\n4\n5\n" },
  "change unterminated range": { args: ["/start/,/missing/c\\\nchanged"], stdin: "one\nstart\nlast\n" },
  "quit prints its current record": { args: ["2q"], stdin: "one\ntwo\nthree\n" },
  "quiet quit suppresses printing": { args: ["-n", "2q"], stdin: "one\ntwo\nthree\n" },
  "line numbers": { args: ["-n", "2{=;p;}"], stdin: "one\ntwo\n" },
  "hold get exchange": { args: ["-n", "1h;2{x;p;x;p;}"], stdin: "first\nsecond\n" },
  "hold append and get append": { args: ["1h;2G"], stdin: "first\nsecond\n" },
  "multiline next substitution": { args: ["N;s/\\n/:/"], stdin: "one\ntwo\nthree\nfour\n" },
  "print first and restart multiline": { args: ["-n", "N;P;D"], stdin: "one\ntwo\nthree\nfour\n" },
  "next command continues same program": { args: ["n;s/a/A/"], stdin: "a\na\na\na\n" },
  "conditional branches repeat bounded substitution": { args: [":again\ns/aa/a/\nt again"], stdin: "aaaa\nbaa\n" },
  "unconditional branch skips substitution": { args: ["/keep/b done\ns/a/A/g\n:done"], stdin: "keep a\nchange a\n" },
  "translation": { args: ["y/abc/ABC/"], stdin: "abc cab\n" },
  "multiple scripts retain option order": { args: ["-e", "s/a/b/g", "-f", "script.sed", "input"], files: { "script.sed": "s/b/c/g\n", input: "aaa\n" } },
  "multiple files share addressing": { args: ["-n", "2,3p", "one", "two"], files: { one: "a\nb\n", two: "c\nd\n" } },
  "in-place backup and per-file addresses": { args: ["-i.bak", "1s/a/A/", "one", "two"], files: { one: "a\na\n", two: "a\na\n" } },
  "in-place empty suffix": { args: ["-i", "", "s/a/A/g", "input"], files: { input: "banana\n" } },
  "missing final newline preserved": { args: ["s/a/A/g"], stdin: "banana" },
};

for (const [name, fixture] of Object.entries(cases)) test(`sed native differential: ${name}`, () => compareNative("sed", fixture));

test("sed rejects unsupported or malformed programs before stdout, input, backup or file effects", async () => {
  for (const program of ["p;s/a/b/e", "p;w", "p;{", "p;b missing", "p;s/(/x/", "p;s/a/\\9/"]) {
    let consumed = false;
    const source = (async function* () { consumed = true; yield Buffer.from("a\n"); })();
    const result = await runVirtual("sed", { args: ["-E", "-i.bak", program, "input"], files: { input: "a\n" } }, {}, source);
    assert.notEqual(result.exitCode, 0, program);
    assert.equal(result.stdout.length, 0, program);
    assert.equal(consumed, false, program);
    assert.deepEqual(result.files, { input: Buffer.from("a\n") }, program);
  }
});

test("sed branch and regex work are budgeted and failed in-place execution preserves originals", async () => {
  const loop = await runVirtual("sed", { args: ["-i.bak", ":again\nb again", "input"], files: { input: "a\n" } }, { maxSteps: 50 });
  assert.equal(loop.exitCode, 2);
  assert.match(loop.stderr.toString(), /step limit/u);
  assert.deepEqual(loop.files, { input: Buffer.from("a\n") });
  const regex = await runVirtual("sed", { args: ["-E", "s/(a+)+b/X/"], stdin: "a".repeat(1000) }, { maxSteps: 2000 });
  assert.equal(regex.exitCode, 2);
  assert.match(regex.stderr.toString(), /step limit/u);
});

test("sed accepts one-byte input chunks and composes with the virtual shell", async () => {
  const streamed = await runVirtual("sed", { args: ["s/pear/apple/g"], stdin: "pear\npear" }, {}, byteChunks("pear\npear"));
  assert.equal(streamed.stdout.toString(), "apple\napple");
  const fs = await makeFileSystem();
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(textProgramCommands());
  const result = await shell.exec("printf 'keep:pear\\nskip:no\\nkeep:apple\\n' | sed -n '/^keep:/{s/^keep://;p;}' | sort | tee result");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "apple\npear\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/result")), result.stdout);
});

import assert from "node:assert/strict";
import test from "node:test";
import { chunks, fixture, run } from "./helpers.js";

test("grep handles fixed/basic/extended patterns, case, line numbers and counts", async () => {
  const stdin = "alpha\nBeta\na+b\nabb\n";
  assert.equal((await run("grep", ["-in", "^beta$"], { stdin: chunks(stdin) })).stdout, "2:Beta\n");
  assert.equal((await run("grep", ["-F", "a+b"], { stdin })).stdout, "a+b\n");
  assert.equal((await run("grep", ["a+b"], { stdin })).stdout, "a+b\n");
  assert.equal((await run("grep", ["-E", "ab+"], { stdin })).stdout, "abb\n");
  assert.equal((await run("grep", ["-vc", "^a"], { stdin })).stdout, "1\n");
  assert.equal((await run("grep", ["-c", "absent"], { stdin })).exitCode, 1);
  assert.equal((await run("grep", ["-c", "absent"], { stdin })).stdout, "0\n");
});

test("grep supports repeated/pattern-file expressions, word/whole-line and only-match selection", async () => {
  const fs = await fixture({ patterns: "cat\ndog\n", empty: "" });
  assert.equal((await run("grep", ["-w", "-f", "patterns"], { fs, stdin: "cat\ncatfish\ndog!\n" })).stdout, "cat\ndog!\n");
  assert.equal((await run("grep", ["-x", "-e", "cat", "-e", "dog"], { stdin: "cat\ndog!\ndog" })).stdout, "cat\ndog\n");
  assert.equal((await run("grep", ["-Eo", "[[:digit:]]+"], { stdin: chunks("ab12 cd34\n") })).stdout, "12\n34\n");
  assert.equal((await run("grep", ["-f", "empty"], { fs, stdin: "anything" })).exitCode, 1);
  assert.equal((await run("grep", ["-e", ""], { stdin: "anything" })).stdout, "anything\n");
});

test("grep uses match/no-match/error statuses and honors filename, quiet and max-count flags", async () => {
  const fs = await fixture({ first: "hit\nhit\n", second: "miss\n" });
  assert.equal((await run("grep", ["hit", "first", "second"], { fs })).stdout, "first:hit\nfirst:hit\n");
  assert.equal((await run("grep", ["-l", "hit", "first", "second"], { fs })).stdout, "first\n");
  assert.equal((await run("grep", ["-L", "hit", "first", "second"], { fs })).stdout, "second\n");
  assert.equal((await run("grep", ["-m", "1", "hit", "first"], { fs })).stdout, "hit\n");
  assert.equal((await run("grep", ["-q", "hit", "first"], { fs })).stdout, "");
  assert.equal((await run("grep", ["hit", "missing"], { fs })).exitCode, 2);
  assert.equal((await run("grep", ["-s", "hit", "missing"], { fs })).stderr, "");
  assert.equal((await run("grep", ["["])).exitCode, 2);
});

test("test and bracket support strings, integers, boolean operators, filesystem predicates and syntax errors", async () => {
  const fs = await fixture({ file: "data", empty: "" });
  await fs.symlink("missing", "/work/dangling");
  assert.equal((await run("test", [])).exitCode, 1);
  assert.equal((await run("test", ["-n"])).exitCode, 0);
  assert.equal((await run("[", ["a b", "=", "a b", "]"])).exitCode, 0);
  assert.equal((await run("[", ["true"])).exitCode, 2);
  assert.equal((await run("test", ["9007199254740993", "-gt", "9007199254740992"])).exitCode, 0);
  assert.equal((await run("test", ["bad", "-eq", "1"])).exitCode, 2);
  assert.equal((await run("test", ["-f", "file", "-a", "!", "-s", "empty"], { fs })).exitCode, 0);
  assert.equal((await run("test", ["-L", "dangling"], { fs })).exitCode, 0);
  assert.equal((await run("test", ["-e", "dangling"], { fs })).exitCode, 1);
  await fs.link("/work/file", "/work/hard");
  assert.equal((await run("test", ["file", "-ef", "hard"], { fs })).exitCode, 0);
  assert.equal((await run("test", ["(", "", "-o", "value", ")", "-a", "-d", "/work"], { fs })).exitCode, 0);
});

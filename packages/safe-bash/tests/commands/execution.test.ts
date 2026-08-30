import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes, type CommandContext } from "../../src/contracts/index.js";
import { chunks, fixture, run } from "./helpers.js";

test("env lists, clears, unsets and sets literal variables without mutating its parent", async () => {
  const env = { FIRST: "one", SECOND: "two" };
  assert.equal((await run("env", ["-0", "-u", "FIRST", "THIRD=three"], { env })).stdout, "THIRD=three\0SECOND=two\0");
  assert.equal((await run("env", ["-i", "LITERAL=$(not executed)"])).stdout, "LITERAL=$(not executed)\n");
  assert.deepEqual(env, { FIRST: "one", SECOND: "two" });
  const calls: CommandContext[] = [];
  const result = await run("env", ["-i", "VALUE=literal", "custom", "a;b"], { execute: context => { calls.push(context); return { exitCode: 7 }; } });
  assert.equal(result.exitCode, 7);
  assert.deepEqual(calls[0]!.args, ["a;b"]);
  assert.deepEqual({ ...calls[0]!.env }, { VALUE: "literal" });
});

test("xargs tokenizes quoted/escaped words and batches direct argv without shell expansion", async () => {
  const calls: readonly string[][] = [];
  const collected = calls as string[][];
  const execute = async (context: CommandContext) => {
    assert.equal((await collectBytes(context.stdin, { maxBytes: 100 })).length, 0);
    collected.push([...context.args]);
    return { exitCode: 0 };
  };
  assert.equal((await run("xargs", ["-n", "2", "custom", "initial"], { stdin: chunks("'two words' escaped\\ word '' '$(unsafe);*'"), execute })).exitCode, 0);
  assert.deepEqual(calls, [["initial", "two words", "escaped word"], ["initial", "", "$(unsafe);*"]]);
  assert.equal((await run("xargs", [], { stdin: "one two" })).stdout, "one two\n");
  assert.equal((await run("xargs", ["printf", "<%s>\n"], { stdin: "one two" })).stdout, "<one>\n<two>\n");
});

test("xargs null/custom delimiters, replacement, empty input and errors are explicit", async () => {
  assert.equal((await run("xargs", ["-0", "printf", "<%s>\n"], { stdin: chunks("a b\0\0'quoted'\0") })).stdout, "<a b>\n<>\n<'quoted'>\n");
  assert.equal((await run("xargs", ["-d", ",", "printf", "<%s>\n"], { stdin: "one,two" })).stdout, "<one>\n<two>\n");
  assert.equal((await run("xargs", ["-I", "{}", "printf", "[%s]\n", "pre{}post"], { stdin: chunks("  one two\n'quoted word'\n") })).stdout, "[preone twopost]\n[prequoted wordpost]\n");
  assert.equal((await run("xargs", [])).stdout, "\n");
  assert.equal((await run("xargs", ["-r"])).stdout, "");
  assert.equal((await run("xargs", [], { stdin: "'unmatched" })).exitCode, 2);
  assert.equal((await run("xargs", ["-P", "2"])).exitCode, 2);
  assert.equal((await run("xargs", ["unknown"], { stdin: "one" })).exitCode, 127);
});

test("xargs maps child failures and stops on status 255", async () => {
  let calls = 0;
  assert.equal((await run("xargs", ["-n", "1", "custom"], { stdin: "one two", execute: () => { calls++; return { exitCode: 1 }; } })).exitCode, 123);
  assert.equal(calls, 2);
  calls = 0;
  assert.equal((await run("xargs", ["-n", "1", "custom"], { stdin: "one two", execute: () => { calls++; return { exitCode: 255 }; } })).exitCode, 124);
  assert.equal(calls, 1);
});

test("find traverses virtual trees with name/type/depth filters, boolean expressions and pruning", async () => {
  const fs = await fixture({ "a.txt": "A", "b.log": "B", "nested/c.txt": "C", "skip/hidden.txt": "H" });
  assert.equal((await run("find", [".", "-type", "f", "-name", "*.txt"], { fs })).stdout, "./a.txt\n./nested/c.txt\n./skip/hidden.txt\n");
  assert.equal((await run("find", [".", "-maxdepth", "1", "-type", "f", "-print0"], { fs })).stdout, "./a.txt\0./b.log\0");
  assert.equal((await run("find", [".", "-name", "skip", "-prune", "-o", "-type", "f", "-print"], { fs })).stdout, "./a.txt\n./b.log\n./nested/c.txt\n");
  assert.equal((await run("find", [".", "(", "-name", "a.txt", "-o", "-name", "b.log", ")", "-type", "f"], { fs })).stdout, "./a.txt\n./b.log\n");
  assert.equal((await run("find", [".", "-unsupported"], { fs })).exitCode, 2);
});

test("find executes semicolon and plus forms with literal argv and detects symlink loops", async () => {
  const fs = await fixture({ "a;literal": "A", "b file": "B" });
  assert.equal((await run("find", [".", "-type", "f", "-exec", "printf", "<%s>\n", "{}", ";"], { fs })).stdout, "<./a;literal>\n<./b file>\n");
  assert.equal((await run("find", [".", "-type", "f", "-exec", "printf", "<%s>\n", "{}", "+"], { fs })).stdout, "<./a;literal>\n<./b file>\n");
  await fs.symlink(".", "/work/loop");
  assert.equal((await run("find", [".", "-type", "l"], { fs })).stdout, "./loop\n");
  assert.equal((await run("find", ["-L", "."], { fs })).exitCode, 1);
});

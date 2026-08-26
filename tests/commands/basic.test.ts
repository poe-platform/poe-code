import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createStandardCommands, standardCommands } from "../../src/commands/index.js";
import { fixture, run } from "./helpers.js";

test("standard plugin exports real handlers and detects collisions before registration", async () => {
  assert(createStandardCommands().some(command => command.name === "printf"));
  const commands = new CommandRegistry([{ name: "echo", execute: () => ({ exitCode: 9 }) }]);
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => standardCommands().setup(host), /already registered/u);
  assert.equal(commands.list().length, 1);
  await standardCommands({ replace: true }).setup(host);
  assert(commands.has("printf"));
});

test("echo handles option groups, literal unknown options, escapes and stop", async () => {
  assert.equal((await run("echo", ["-n", "one", "two"])).stdout, "one two");
  assert.equal((await run("echo", ["--", "-x"])).stdout, "-- -x\n");
  assert.equal((await run("echo", ["-e", "one\\ttwo\\cignored"])).stdout, "one\ttwo");
  assert.deepEqual((await run("echo", ["-ne", "\\0377"])).stdoutBytes, Buffer.from([255]));
  assert.equal((await run("echo", ["-eE", "\\n"])).stdout, "\\n\n");
});

test("printf repeats formats, defaults missing fields, and preserves empty strings", async () => {
  assert.equal((await run("printf", ["<%s>:%d\n", "one", "2", ""])).stdout, "<one>:2\n<>:0\n");
  assert.equal((await run("printf", ["literal %%\n", "unused"])).stdout, "literal %\n");
  assert.equal((await run("printf", ["%s", "no newline"])).stdout, "no newline");
  assert.equal((await run("printf", ["--", "-%s", "literal"])).stdout, "-literal");
});

test("printf formats common numbers, padding, precision, and byte escapes", async () => {
  assert.equal((await run("printf", ["%05d|%-5.3s|%#x|%.2f|%o\n", "-3", "abcdef", "15", "1.25", "8"])).stdout, "-0003|abc  |0xf|1.25|10\n");
  assert.deepEqual((await run("printf", ["%b", "\\0377\\0\\n"])).stdoutBytes, Buffer.from([255, 0, 10]));
  assert.equal((await run("printf", ["%bafter", "before\\cignored"])).stdout, "before");
  assert.equal((await run("printf", ["%d", "010"])).stdout, "8");
  assert.equal((await run("printf", ["%d", "9007199254740993"])).stdout, "9007199254740993");
  assert.deepEqual((await run("printf", ["%.1s", "é"])).stdoutBytes, Buffer.from([195]));
  assert.equal((await run("printf", ["%4b", "x"])).stdout, "   x");
  const invalid = await run("printf", ["%d", "oops"]);
  assert.equal(invalid.exitCode, 1);
  assert.match(invalid.stderr, /invalid number/u);
  assert.equal((await run("printf", ["%99999999s", "x"])).exitCode, 2);
  assert.equal((await run("printf", ["%j", "x"])).exitCode, 2);
});

test("pwd logical and physical paths stay inside virtual filesystem", async () => {
  const fs = await fixture();
  await fs.symlink("/work", "/alias");
  assert.equal((await run("pwd", [], { fs, cwd: "/alias" })).stdout, "/alias\n");
  assert.equal((await run("pwd", ["-P"], { fs, cwd: "/alias" })).stdout, "/work\n");
  assert.equal((await run("pwd", ["unexpected"])).exitCode, 2);
});

test("basename and dirname handle roots, suffixes, multiple names and zero output", async () => {
  assert.equal((await run("basename", ["/a/name.txt/", ".txt"])).stdout, "name\n");
  assert.equal((await run("basename", ["-s", ".txt", "a.txt", "b.txt"])).stdout, "a\nb\n");
  assert.equal((await run("basename", ["///"])).stdout, "/\n");
  assert.equal((await run("basename", ["same", "same"])).stdout, "same\n");
  assert.equal((await run("dirname", ["-z", "/a/b///", "name", "/"])).stdout, "/a\0.\0/\0");
});

test("true and false ignore arguments and cancellation propagates", async () => {
  assert.equal((await run("true", ["--anything"])).exitCode, 0);
  assert.equal((await run("false")).exitCode, 1);
  const reason = new Error("cancelled");
  await assert.rejects(run("echo", ["not written"], { signal: AbortSignal.abort(reason) }), error => error === reason);
});

import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes, createCommandArguments, getCommandArguments, toByteSource, type CommandContext, type CommandInvoker } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";
import { options as commandOptions } from "../../src/commands/internal.js";
import { chunks, fixture, run } from "./helpers.js";

for (const entry of [
  { name: "env direct fallback", command: "env", values: ["-i", "capture", [255], [254]], stdin: "", invoke: false, expected: [[[255], [254]]] },
  { name: "env invoke adapter", command: "env", values: ["--", "capture", [255], [254]], stdin: "", invoke: true, expected: [[[255], [254]]] },
  { name: "env split string", command: "env", values: ["-S", [99, 97, 112, 116, 117, 114, 101, 32, 255, 32, 254]], stdin: "", invoke: true, expected: [[[255], [254]]] },
  { name: "env split quoted empty and opaque spaces", command: "env", values: ["-S", [99, 97, 112, 116, 117, 114, 101, 32, 39, 39, 32, 34, 255, 32, 254, 34]], stdin: "", invoke: true, expected: [[[], [255, 32, 254]]] },
  { name: "env attached split string", command: "env", values: [[45, 83, 99, 97, 112, 116, 117, 114, 101, 32, 255]], stdin: "", invoke: true, expected: [[[255]]] },
  { name: "env long attached split string", command: "env", values: [[45, 45, 115, 112, 108, 105, 116, 45, 115, 116, 114, 105, 110, 103, 61, 99, 97, 112, 116, 117, 114, 101, 32, 255]], stdin: "", invoke: true, expected: [[[255]]] },
  { name: "env nested split frames", command: "env", values: ["-S", [45, 83, 32, 39, 99, 97, 112, 116, 117, 114, 101, 32, 255, 39]], stdin: "", invoke: true, expected: [[[255]]] },
  { name: "env unquoted split separator", command: "env", values: ["-S", [99, 97, 112, 116, 117, 114, 101, 32, 255, 92, 95, 254]], stdin: "", invoke: true, expected: [[[255], [254]]] },
  { name: "xargs batching", command: "xargs", values: ["-n", "1", "capture", [255]], stdin: "one two", invoke: true, expected: [[[255], [111, 110, 101]], [[255], [116, 119, 111]]] },
  { name: "xargs literal replacement", command: "xargs", values: ["-I", "{}", "capture", [255, 123, 125, 254]], stdin: "A", invoke: false, expected: [[[255, 65, 254]]] },
  { name: "find semicolon replacement", command: "find", values: [".", "-type", "f", "-exec", "capture", [255, 123, 125, 254], ";"], stdin: "", invoke: false, expected: [[[255, 46, 47, 102, 105, 108, 101, 254]]] },
  { name: "find batched arguments", command: "find", values: [".", "-type", "f", "-exec", "capture", [255], "{}", "+"], stdin: "", invoke: true, expected: [[[255], [46, 47, 102, 105, 108, 101]]] },
  { name: "timeout zero deadline", command: "timeout", values: ["--", "0", "capture", [255], [254]], stdin: "", invoke: true, expected: [[[255], [254]]] },
]) test(`command forwarding preserves byte operands: ${entry.name}`, async () => {
  const argumentValues = createCommandArguments(entry.values.map(value => typeof value === "string" ? value : shellValueFromBytes(Uint8Array.from(value))));
  const captured: number[][][] = [];
  const execute = (context: CommandContext) => {
    const selected = getCommandArguments(context);
    captured.push(selected.args.map((_value, index) => Array.from(selected.bytes(index)!)));
    return { exitCode: 0 };
  };
  const errors: Uint8Array[] = [];
  const context: CommandContext = {
    command: entry.command, args: argumentValues.args, argumentValues, cwd: "/work", env: {}, fs: await fixture({ file: "data" }),
    signal: new AbortController().signal, stdin: toByteSource(entry.stdin), stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes.slice()); } },
  };
  const invoke: CommandInvoker = async (command, args, options = {}) => execute({ ...context, command, args, argumentValues: options.argumentValues! });
  const incoming = entry.invoke ? { ...context, invoke } : context;
  const definition = entry.command === "timeout" ? createTimeoutCommand() : createStandardCommands({ execute }).find(command => command.name === entry.command)!;
  const result = await definition.execute(incoming);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  assert.deepEqual(captured, entry.expected);
});

test("timeout legacy invocation omits carrier metadata and snapshots argv before asynchronous work", async () => {
  const args = ["0", "capture", "before"];
  const stdin = toByteSource("");
  const stdout = { async write() {} };
  const stderr = { async write() {} };
  const context: CommandContext = {
    command: "timeout", args, cwd: "/work", env: {}, fs: await fixture(),
    signal: new AbortController().signal, stdin, stdout, stderr,
    async invoke(command, selected, options) {
      await Promise.resolve();
      assert.equal(command, "capture");
      assert.deepEqual(selected, ["before"]);
      assert.ok(Object.isFrozen(selected));
      assert.deepEqual(options, { stdin, stdout, stderr });
      return { exitCode: 7 };
    },
  };
  const pending = createTimeoutCommand().execute(context);
  args[2] = "after";
  assert.deepEqual(await pending, { exitCode: 7 });
});

test("timeout rejects an explicitly stale carrier before child dispatch", async () => {
  const argumentValues = createCommandArguments(["0", "capture", shellValueFromBytes(Uint8Array.of(255))]);
  let calls = 0;
  const context: CommandContext = {
    command: "timeout", args: [...argumentValues.args], argumentValues, cwd: "/work", env: {}, fs: await fixture(),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    async invoke() { calls++; return { exitCode: 0 }; },
  };
  await assert.rejects(async () => createTimeoutCommand().execute(context), /argument identity does not match/);
  assert.equal(calls, 0);
});

for (const entry of [
  { name: "NUL", bytes: [99, 97, 112, 116, 117, 114, 101, 32, 255, 0], diagnostic: /NUL is not supported/ },
  { name: "unknown escape", bytes: [99, 97, 112, 116, 117, 114, 101, 32, 255, 92, 120], diagnostic: /invalid sequence/ },
  { name: "unterminated quote", bytes: [99, 97, 112, 116, 117, 114, 101, 32, 34, 255], diagnostic: /no terminating quote/ },
]) test(`byte env split refuses ${entry.name} before dispatch`, async () => {
  const argumentValues = createCommandArguments(["-S", shellValueFromBytes(Uint8Array.from(entry.bytes))]);
  const errors: Uint8Array[] = [];
  let invoked = false;
  const definition = createStandardCommands({ execute() { invoked = true; return { exitCode: 0 }; } }).find(command => command.name === "env")!;
  const result = await definition.execute({ command: "env", args: argumentValues.args, argumentValues, cwd: "/work", env: {}, fs: await fixture(), signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
  assert.equal(result.exitCode, 125);
  assert.equal(invoked, false);
  assert.match(Buffer.concat(errors).toString(), entry.diagnostic);
});

const operandCases: readonly {
  name: string; args: readonly string[]; short: string;
  long: Readonly<Record<string, string>>; stop: boolean; indices: readonly number[];
}[] = [
  { name: "separate option values and identical operands", args: ["-n", "2", "child", "same", "same"], short: "n:", long: {}, stop: true, indices: [2, 3, 4] },
  { name: "attached option and delimiter", args: ["-n2", "--", "-same", ""], short: "n:", long: {}, stop: false, indices: [2, 3] },
  { name: "long equals option and delimiter after operand", args: ["--count=2", "same", "--", "same"], short: "n:", long: { count: "n" }, stop: false, indices: [1, 3] },
  { name: "stop at first operand preserves remaining tokens", args: ["first", "-n", "2", "--", "last"], short: "n:", long: {}, stop: true, indices: [0, 1, 2, 3, 4] },
  { name: "clustered option argument", args: ["-abvalue", "same", "same"], short: "ab:", long: {}, stop: false, indices: [1, 2] },
];

for (const entry of operandCases) test(`option parsing reports literal operand indices: ${entry.name}`, () => {
  const observed: number[] = [];
  const parsed = commandOptions(entry.args, entry.short, entry.long, entry.stop, index => { observed.push(index); });
  assert.deepEqual(observed, entry.indices);
  assert.deepEqual(parsed.operands, entry.indices.map(index => entry.args[index]));
  assert.deepEqual(parsed, commandOptions(entry.args, entry.short, entry.long, entry.stop));
});

for (const reason of [false, 0, undefined, new Error("operand observer failure")]) test(
  `option parsing preserves operand observer failure identity: ${String(reason)}`, () => {
    let caught = false;
    let calls = 0;
    try {
      commandOptions(["first", "second"], "", {}, false, () => { calls++; throw reason; });
    } catch (error) { caught = true; assert.equal(error, reason); }
    assert.equal(caught, true);
    assert.equal(calls, 1);
  },
);

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

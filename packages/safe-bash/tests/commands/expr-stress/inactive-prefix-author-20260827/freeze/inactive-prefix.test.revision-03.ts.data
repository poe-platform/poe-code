import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Budget } from "../../../src/commands/expr/internal.js";
import { exprCommands, type ExprCommandsOptions, type ExprLimits } from "../../../src/commands/expr/index.js";
import { RegexSession } from "../../../src/commands/regex-execution/client.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { run } from "./helpers.js";

function observe(context: TestContext) {
  const encodes: string[] = [], jobs: string[] = [];
  const budgets = new Map<Budget, number>();
  const encode = Budget.prototype.encode, charge = Budget.prototype.charge;
  const match = RegexSession.prototype.matchExpr;
  let pending = 0;
  context.mock.method(Budget.prototype, "encode", function (this: Budget, text: string) {
    encodes.push(text);
    return encode.call(this, text);
  });
  context.mock.method(Budget.prototype, "charge", function (this: Budget, amount = 1) {
    const previous = budgets.get(this);
    if (previous !== undefined) assert(this.remaining() <= previous, "shared work budget never resets");
    try { return charge.call(this, amount); }
    finally { budgets.set(this, this.remaining()); }
  });
  context.mock.method(RegexSession.prototype, "matchExpr", async function (this: RegexSession, ...args: Parameters<typeof match>) {
    assert.equal(pending++, 0, "regex jobs remain sequential");
    jobs.push(Buffer.from(args[1]).toString());
    try { return await match.apply(this, args); }
    finally { pending--; }
  });
  return { encodes, jobs, budgets };
}

const noFileSystem = new Proxy(createMemoryFileSystem(), {
  get() { throw new Error("argv-only expr accessed the filesystem"); },
});

async function checked(context: TestContext, args: readonly string[], expected: string,
  options: ExprCommandsOptions = {}, env = { LC_ALL: "C" }, forbidden: readonly string[] = [], jobs: readonly string[] = []) {
  const observed = observe(context);
  const actual = await run(args, options, { env, fs: noFileSystem });
  assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected === "0\n" || expected === "\n" ? 1 : 0, expected, ""]);
  assert.deepEqual(observed.jobs, jobs);
  assert.equal(observed.budgets.size, 1);
  for (const text of forbidden) assert(!observed.encodes.includes(text), `inactive operand encoded: ${text}`);
  return observed;
}

test("frozen sequencing control: inactive length does not evaluate locale or encode operand", async context => {
  await checked(context, ["1", "|", "length", "abc"], "1\n", {},
    { LC_ALL: "unsupported-sequencing-profile" }, ["abc"]);
});

test("frozen sequencing control: inactive substr does not convert numbers or encode operands", async context => {
  await checked(context, ["1", "|", "substr", "abc", "999", "1"], "1\n",
    { limits: { maxNumericDigits: 1 } }, { LC_ALL: "C" }, ["abc", "999"]);
});

const inactivePrefixes = [
  ["length", "inactive-length"],
  ["index", "inactive-index", "z"],
  ["substr", "inactive-substr", "999", "888"],
  ["match", "inactive-match", "["],
] as const;
const wrappers = [
  { name: "OR", before: ["1", "|"], after: [], expected: "1\n" },
  { name: "AND", before: ["0", "&"], after: [], expected: "0\n" },
  { name: "OR containing AND/OR", before: ["1", "|", "(", "0", "|", "1", "&"], after: [")"], expected: "1\n" },
  { name: "AND containing OR/AND", before: ["0", "&", "(", "1", "&", "0", "|"], after: [")"], expected: "0\n" },
];
for (const prefix of inactivePrefixes) for (const wrapper of wrappers) {
  test(`inactive ${prefix[0]} under ${wrapper.name} performs no reduction`, async context => {
    await checked(context, [...wrapper.before, ...prefix, ...wrapper.after], wrapper.expected,
      { limits: { maxNumericDigits: 1 } }, { LC_ALL: "unsupported-inactive-profile" }, prefix.slice(1));
  });
}

for (const prefix of [
  ["length", "match", "hidden", "["],
  ["index", "length", "hidden", "match", "other", "["],
  ["substr", "match", "hidden", "[", "(", "1", "/", "0", ")", "999"],
  ["match", "substr", "hidden", "999", "1", "match", "other", "["],
]) test(`inactive nested ${prefix[0]} never evaluates arguments`, async context => {
  await checked(context, ["1", "|", ...prefix], "1\n", { limits: { maxNumericDigits: 1 } },
    { LC_ALL: "unsupported-inactive-profile" }, ["hidden", "other", "999", "["]);
});

for (const [args, expected] of [
  [["1", "|", "+", "length"], "1\n"],
  [["0", "&", "+", ")"], "0\n"],
  [["+", "length"], "length\n"],
] as const) test(`literal quoting retains grammar ${JSON.stringify(args)}`, async context => {
  await checked(context, args, expected);
});

const malformed: readonly [readonly string[], string][] = [
  [["1", "|", "length"], "syntax error: missing argument after 'length'"],
  [["0", "&", "index", "abc"], "syntax error: missing argument after 'abc'"],
  [["1", "|", "substr", "abc", "1"], "syntax error: missing argument after '1'"],
  [["0", "&", "match", "abc"], "syntax error: missing argument after 'abc'"],
  [["1", "|", "+"], "syntax error: missing argument after '+'"],
  [["1", "|", "length", "(", "1", "/", "0"], "syntax error: expecting ')' after '0'"],
  [["0", "&", "(", "1", "|", "index", "abc", ")"], "syntax error: unexpected ')'"],
  [["1", "|", "match", "abc", "[", "x"], "syntax error: unexpected argument 'x'"],
  [["1", "|", "substr", "match", "abc", "[", "1"], "syntax error: missing argument after '1'"],
];
for (const [args, message] of malformed) test(`inactive malformed grammar ${JSON.stringify(args)}`, async context => {
  const observed = observe(context);
  const actual = await run(args, {}, { fs: noFileSystem });
  assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [2, "", `expr: ${message}\n`]);
  assert.deepEqual(observed.jobs, []);
  assert.equal(observed.budgets.size, 1);
});

for (const locale of ["C", "C.UTF-8"]) for (const [args, byteExpected, unicodeExpected] of [
  [["length", "a😀z"], "6\n", "3\n"],
  [["index", "a😀z", "z"], "6\n", "3\n"],
  [["substr", "a😀z", "2", "4"], "😀\n", "😀z\n"],
] as const) test(`active ${args[0]} unchanged in ${locale}`, async context => {
  await checked(context, args, locale === "C" ? byteExpected : unicodeExpected, {}, { LC_ALL: locale });
});

for (const prefix of inactivePrefixes) test(`active ${prefix[0]} still rejects unsupported character locale`, async context => {
  const observed = observe(context);
  const actual = await run(prefix, {}, { env: { LC_ALL: "unsupported-inactive-profile" }, fs: noFileSystem });
  assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr],
    [2, "", "expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n"]);
  assert.deepEqual(observed.jobs, []);
});

for (const [args, expected, jobs] of [
  [["match", "abc", "a.*"], "3\n", ["abc"]],
  [["0", "|", "length", "abc"], "3\n", []],
  [["1", "&", "substr", "abc", "2", "1"], "1\n", []],
  [["match", "a", "a", "|", "match", "hidden", "["], "1\n", ["a"]],
  [["(", "match", "a", "b", "|", "length", "", ")", "|", "match", "b", "b"], "1\n", ["a", "b"]],
  [["(", "match", "a", "a", "+", "match", "b", "b", ")", "|", "substr", "hidden", "999", "1"], "2\n", ["a", "b"]],
] as const) test(`active and skipped calls execute once ${JSON.stringify(args)}`, async context => {
  const observed = await checked(context, args, expected, {}, { LC_ALL: "C" }, ["hidden", "999"], jobs);
  assert.equal(observed.encodes.filter(text => text === "abc").length, args.some(argument => argument === "abc") ? 1 : 0);
});

const limits: readonly [readonly string[], Partial<ExprLimits>, string][] = [
  [["1", "|", "substr", "abc", "999", "1"], { maxArgumentBytes: 5 }, "aggregate argument bytes"],
  [["1", "|", "substr", "abc", "999", "1"], { maxNodes: 1 }, "argument count"],
  [["1", "|", "length", "abc"], { maxNodes: 3 }, "AST node"],
  [["1", "|", "length", "length", "abc"], { maxDepth: 2 }, "parser depth"],
  [["1", "|", "length", "abc", "|", "1"], { maxDepth: 3 }, "AST depth"],
  [["1", "|", "substr", "abc", "999", "1"], { maxSteps: 1 }, "evaluation work"],
  [["substr", "abc", "999", "1"], { maxNumericDigits: 1 }, "numeric digits"],
  [["length", "0123456789"], { maxNumericDigits: 1 }, "numeric result digits"],
  [["length", "abc"], { maxStringBytes: 2 }, "string allocation"],
  [["1", "|", "length", "abc"], { maxOutputBytes: 1 }, "output bytes"],
];
for (const [args, options, label] of limits) test(`retained ${label} limit ${JSON.stringify(options)}`, async context => {
  const observed = observe(context);
  const actual = await run(args, { limits: options }, { fs: noFileSystem });
  assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [3, "", `expr: ${label} limit exceeded\n`]);
  assert.deepEqual(observed.jobs, []);
  assert.equal(observed.budgets.size, label === "argument count" ? 0 : 1);
});

test("inactive call retains its evaluator work checkpoint", async context => {
  const observed = observe(context);
  const checkpoint = Budget.prototype.yield;
  let checkpoints = 0;
  context.mock.method(Budget.prototype, "yield", async function (this: Budget) {
    if (++checkpoints === 3) this.charge(this.remaining());
    return checkpoint.call(this);
  });
  const actual = await run(["1", "|", "length", "abc"], {}, { fs: noFileSystem });
  assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [3, "", "expr: evaluation work limit exceeded\n"]);
  assert.equal(checkpoints, 3);
  assert(!observed.encodes.includes("abc"));
  assert.equal(observed.budgets.size, 1);
});

class StructuralSignal extends EventTarget implements AbortSignal {
  aborted = false;
  reason: unknown;
  onabort: ((this: AbortSignal, event: Event) => unknown) | null = null;
  throwIfAborted(): void { if (this.aborted) throw this.reason; }
  abort(reason: unknown): void {
    this.reason = reason;
    this.aborted = true;
    this.dispatchEvent(new Event("abort"));
  }
}

for (const reason of [undefined, null, false, 0, "", Object.assign(new Error("cancelled"), { code: "ENOENT" })]) {
  test(`inactive call checkpoint preserves abort identity: ${String(reason)}`, async context => {
    const signal = new StructuralSignal();
    const observed = observe(context);
    const checkpoint = Budget.prototype.yield;
    let checkpoints = 0, writes = 0;
    context.mock.method(Budget.prototype, "yield", async function (this: Budget) {
      if (++checkpoints === 3) signal.abort(reason);
      return checkpoint.call(this);
    });
    await assert.rejects(run(["1", "|", "length", "abc"], {}, {
      signal, fs: noFileSystem,
      stdout: { async write() { writes++; } }, stderr: { async write() { writes++; } },
    }), error => Object.is(error, reason));
    assert.equal(checkpoints, 3);
    assert.equal(writes, 0);
    assert.deepEqual(observed.jobs, []);
    assert(!observed.encodes.includes("abc"));
  });
}

test("actual Shell/registry preserves nested inactive calls and literal invoke dispatch", async context => {
  const observed = observe(context);
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "unsupported-inactive-profile" } });
  shell.use(exprCommands({ limits: { maxNumericDigits: 1 } }));
  shell.use(async (invocation, next) => {
    if (invocation.command === "expr" && invocation.args[0] === "dispatch") {
      return invocation.invoke!("expr", ["1", "|", "(", "0", "|", "substr", "hidden", "999", "1", ")"]);
    }
    return next();
  });
  try {
    const actual = await shell.exec("expr dispatch");
    assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [0, "1\n", ""]);
    assert(!observed.encodes.includes("hidden"));
    assert(!observed.encodes.includes("999"));
    assert.deepEqual(observed.jobs, []);
    assert.equal(observed.budgets.size, 1);
  } finally { await shell.dispose(); }
});

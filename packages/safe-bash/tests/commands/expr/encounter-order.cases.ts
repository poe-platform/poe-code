import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Budget } from "../../../src/commands/expr/internal.js";
import { exprCommands } from "../../../src/commands/expr/index.js";
import { RegexSession } from "../../../src/commands/regex-execution/client.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { run } from "./helpers.js";

function observe(context: TestContext) {
  const encodes: string[] = [], events: string[] = [];
  const budgets = new Map<Budget, number>();
  const encode = Budget.prototype.encode, charge = Budget.prototype.charge;
  const match = RegexSession.prototype.matchExpr;
  let pending = false;
  context.mock.method(Budget.prototype, "encode", function (this: Budget, text: string) {
    encodes.push(text);
    return encode.call(this, text);
  });
  context.mock.method(Budget.prototype, "charge", function (this: Budget, amount = 1) {
    assert(this.remaining() <= (budgets.get(this) ?? Infinity));
    try { return charge.call(this, amount); }
    finally { budgets.set(this, this.remaining()); }
  });
  context.mock.method(RegexSession.prototype, "matchExpr", async function (this: RegexSession, ...args: Parameters<typeof match>) {
    assert.equal(pending, false);
    pending = true;
    const subject = Buffer.from(args[1]).toString();
    events.push(`start:${subject}`);
    try { return await match.apply(this, args); }
    finally { events.push(`end:${subject}`); pending = false; }
  });
  return { encodes, events, budgets };
}

const errors: readonly [readonly string[], string, readonly string[]][] = [
  [["7", "/", "0", "late"], "division by zero", []],
  [["7", "%", "0", "+"], "division by zero", []],
  [["bad", "*", "2", "+", "length"], "non-integer argument", []],
  [["(", "7", "/", "0"], "division by zero", []],
  [["length", "(", "7", "/", "0", ")", "late"], "division by zero", []],
  [["substr", "abc", "(", "7", "/", "0", ")"], "division by zero", []],
  [["7", "/", "(", "0", "late", ")"], "syntax error: expecting ')' instead of 'late'", []],
  [["7", "/", "0", ":"], "syntax error: missing argument after ':'", []],
  [["bad", "+", "length"], "syntax error: missing argument after 'length'", []],
  [["bad", "+", "7", "/", "0"], "division by zero", []],
  [["a", ":", "[", "late"], "Invalid regular expression", ["a"]],
  [["(", "a", ":", "["], "Invalid regular expression", ["a"]],
  [["index", "match", "a", "["], "Invalid regular expression", ["a"]],
  [["a", ":", "a", "late"], "syntax error: unexpected argument 'late'", ["a"]],
  [["(", "a", ":", "a"], "syntax error: expecting ')' after 'a'", ["a"]],
  [["match", "(", "a", ":", "a", ")", "("], "syntax error: missing argument after '('", ["a"]],
  [["a", ":", "(", "[", "late", ")"], "syntax error: expecting ')' instead of 'late'", []],
];
for (const [args, message, subjects] of errors) test(`encounter-order v2 ${JSON.stringify(args)}`, async context => {
  const observed = observe(context);
  const actual = await run(args);
  assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [2, "", `expr: ${message}\n`]);
  assert.deepEqual(observed.events, subjects.flatMap(subject => [`start:${subject}`, `end:${subject}`]));
  assert.equal(observed.budgets.size, 1);
});

for (const skipped of [
  ["HIDDEN", "+", "999"], ["HIDDEN", ":", "["], ["length", "HIDDEN"],
  ["index", "HIDDEN", "Z"], ["substr", "HIDDEN", "999", "888"], ["match", "HIDDEN", "["],
]) test(`encounter-order v2 inactive values absent ${JSON.stringify(skipped)}`, async context => {
  const observed = observe(context);
  const actual = await run(["1", "|", "(", "0", "|", ...skipped, ")"],
    { limits: { maxStringBytes: 1, maxNumericDigits: 1 } }, { env: { LC_ALL: "unsupported-encounter-profile" } });
  assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [0, "1\n", ""]);
  assert.deepEqual(observed.encodes, ["1"]);
  assert.deepEqual(observed.events, []);
  assert.equal(observed.budgets.size, 1);
});

test("encounter-order v2 sequential jobs cross logical and arithmetic boundaries once", async context => {
  const observed = observe(context);
  const actual = await run(["(", "a", ":", "a", "|", "match", "HIDDEN", "[", ")", "+", "(", "b", ":", "b", ")", "+", "(", "c", ":", "c", ")"]);
  assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [0, "3\n", ""]);
  assert.deepEqual(observed.events, ["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  assert(!observed.encodes.includes("HIDDEN"));
  assert.equal(observed.budgets.size, 1);
});

test("encounter-order v2 global argv admission precedes active evaluation", async context => {
  const observed = observe(context);
  const actual = await run(["a", ":", "a", "oversized"], { limits: { maxArgumentBytes: 3 } });
  assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [3, "", "expr: aggregate argument bytes limit exceeded\n"]);
  assert.deepEqual(observed.events, []);
  assert.deepEqual(observed.encodes, []);
});

test("encounter-order v2 skipped structural nodes remain bounded without encoding", async context => {
  const observed = observe(context);
  const actual = await run(["1", "|", "length", "HIDDEN"], { limits: { maxNodes: 2 } });
  assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [3, "", "expr: AST node limit exceeded\n"]);
  assert(!observed.encodes.includes("HIDDEN"));
  assert.deepEqual(observed.events, []);
});

test("encounter-order v2 forced tokens and left associativity retain grammar", async () => {
  for (const [args, expected] of [
    [["+", ")"], ")\n"], [["length", "+", "match"], "5\n"],
    [["20", "/", "2", "/", "2"], "5\n"], [["--", "2", "+", "3", "*", "4"], "14\n"],
    [["length", "abc", ":", "3"], "1\n"],
  ] as const) {
    const actual = await run(args);
    assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [0, expected, ""]);
  }
});

test("encounter-order v2 actual Shell invocation retains earlier error and completed job", async context => {
  const observed = observe(context);
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(exprCommands());
  try {
    const result = await shell.exec("expr a : a / 0 late");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [2, "", "expr: division by zero\n"]);
    assert.deepEqual(observed.events, ["start:a", "end:a"]);
  } finally { await shell.dispose(); }
});

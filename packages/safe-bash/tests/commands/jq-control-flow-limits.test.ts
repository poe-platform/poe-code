import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget, JqError, JqLimitError, resolveJqLimits, type JqLimits, type Json } from "../../src/commands/structured/limits.js";
import { Interpreter } from "../../src/commands/structured/interpreter.js";
import { parse } from "../../src/commands/structured/parser.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";
import { toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { jqCommand } from "../../src/commands/structured/jq.js";

function evaluation(source: string, input: Json = null, limits: Partial<JqLimits> = {}, signal = new AbortController().signal) {
  const budget = new Budget(resolveJqLimits(limits), signal);
  const variables = new Map<string, Json>();
  const ast = parse(source, variables, budget);
  const interpreter = new Interpreter(budget, variables);
  return { budget, interpreter, iterator: interpreter.run(ast, input) };
}

async function drain(iterator: AsyncGenerator<Json>): Promise<void> {
  for await (const value of iterator) void value;
}

for (const source of [
  'try (reduce range(10000) as $item (0; .)) catch "caught"',
  'try (foreach range(10000) as $item (0; .; empty)) catch "caught"',
  'try (reduce 1 as $item (0; range(10000))) catch "caught"',
  'try (foreach empty as $item (range(10000); .)) catch "caught"',
  'try ([.. | empty]) catch "caught"',
]) test(`hidden work shares noncatchable step budget: ${source}`, async () => {
  const { iterator } = evaluation(source, Array<Json>(1000).fill(null), { maxSteps: 100 });
  await assert.rejects(drain(iterator), error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
});

for (const source of [
  "try . catch 1+2+3+4+5+6+7+8",
  "reduce (1+2+3+4+5+6+7+8) as $item (0; .)",
  "reduce 1 as $item (1+2+3+4+5+6+7+8; .)",
  "reduce 1 as $item (0; 1+2+3+4+5+6+7+8)",
  "foreach 1 as $item (0; .; 1+2+3+4+5+6+7+8)",
]) test(`compiler walks flat AST depth inside new nodes: ${source}`, () => {
  assert.throws(() => evaluation(source, null, { maxAstDepth: 6 }), error => error instanceof JqLimitError);
});

for (const source of [
  "try (reduce range(10000) as $item (0; .)) catch 0",
  "try (foreach range(10000) as $item (0; .; empty)) catch 0",
  "try (.. | empty) catch 0",
]) test(`hidden work reaches cooperative checkpoint: ${source}`, async () => {
  const controller = new AbortController();
  const reason = new JqError("checkpoint cancellation");
  registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
  const { iterator } = evaluation(source, Array<Json>(2000).fill(null), {}, controller.signal);
  await assert.rejects(drain(iterator), error => error === reason);
});

test("nested lexical lookups charge the same budget without cloning CLI variables", async () => {
  class Variables extends Map<string, Json> {
    override [Symbol.iterator](): MapIterator<[string, Json]> { throw new Error("variables cloned"); }
  }
  const variables = new Variables([["outer", 7]]);
  const budget = new Budget(resolveJqLimits({ maxSteps: 200 }), new AbortController().signal);
  const ast = parse("reduce range(100) as $item (0; reduce range(100) as $nested (.; .+$outer+$item+$nested))", variables, budget);
  const iterator = new Interpreter(budget, variables).run(ast, null);
  await assert.rejects(drain(iterator), error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
});

test("descent uses bounded stack and stops at an explicitly requested first value", async () => {
  let input: Json = null;
  for (let depth = 0; depth < 256; depth++) input = [input];
  const { iterator } = evaluation("..", input, { maxDepth: 256 });
  let count = 0;
  for await (const value of iterator) { void value; count++; }
  assert.equal(count, 257);
  const first = evaluation("first(..)", input, { maxDepth: 1 });
  assert.equal((await first.iterator.next()).value, input);
  assert.equal((await first.iterator.next()).done, true);
});

for (const source of [
  "foreach range(100) as $item (0; (.,.+1); range(100))",
  "try range(100) catch 0", "..",
]) test(`command output backpressure and falsey sink failure retire generators: ${source}`, async context => {
  let entered!: () => void;
  let rejectWrite!: (reason: unknown) => void;
  const enteredWrite = new Promise<void>(resolve => { entered = resolve; });
  const pendingWrite = new Promise<void>((resolve, reject) => { void resolve; rejectWrite = reject; });
  let writes = 0;
  let produced = 0;
  let active = 0;
  let inputRetired = false;
  const run = Interpreter.prototype.run;
  context.mock.method(Interpreter.prototype, "run", async function* (this: Interpreter, ...args: Parameters<Interpreter["run"]>) {
    active++;
    try { for await (const value of run.apply(this, args)) { produced++; yield value; } }
    finally { active--; }
  });
  const commandContext: CommandContext = {
    command: "jq", args: ["-c", source],
    stdin: (async function* () { try { yield Buffer.from("[1,2]\n"); } finally { inputRetired = true; } })(),
    stdout: { async write() { writes++; entered(); await pendingWrite; } },
    stderr: { async write() { assert.fail("sink failure must not become jq diagnostics"); } },
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
  };
  const execution = Promise.resolve(jqCommand().execute(commandContext));
  await enteredWrite;
  const suspended = produced;
  await Promise.resolve();
  assert.equal(produced, suspended);
  assert.equal(writes, 1);
  rejectWrite(false);
  await assert.rejects(execution, reason => reason === false);
  assert.equal(active, 0);
  assert.equal(inputRetired, true);
});

for (const [source, limits, name] of [
  ["try .. catch 0", { maxResults: 2 }, "maxResults"],
  ["try (foreach range(100) as $item (0; .+$item)) catch 0", { maxOutputBytes: 4 }, "maxOutputBytes"],
  ["try (reduce range(100) as $item ([]; .+[$item])) catch 0", { maxCollectionSize: 8 }, "maxCollectionSize"],
] as const) test(`command-level ${name} remains enforced through control flow`, async () => {
  const stderr: Uint8Array[] = [];
  const result = await jqCommand({ limits }).execute({
    command: "jq", args: ["-c", source], stdin: toByteSource("[1,2]\n"),
    stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 5);
  assert.equal(Buffer.concat(stderr).toString(), `jq: ${name} limit exceeded\n`);
});

test("descent is depth bounded even when outputs are discarded", async () => {
  const { iterator } = evaluation("try (.. | empty) catch 0", [[[[[null]]]]], { maxDepth: 3 });
  await assert.rejects(drain(iterator), error => error instanceof JqLimitError && error.message === "maxDepth limit exceeded");
});

test("descent bounds wide collections", async () => {
  const { iterator } = evaluation("try (.. | empty) catch 0", Array<Json>(6).fill(null), { maxCollectionSize: 5 });
  await assert.rejects(drain(iterator), error => error instanceof JqLimitError && error.message === "maxCollectionSize limit exceeded");
});

for (const source of [
  "try (((((.))))) catch (1+(1+(1+(1+(1+1)))))",
  "reduce (1+(1+(1+(1+(1+1))))) as $item (0; .)",
  "reduce 1 as $item (1+(1+(1+(1+(1+1)))); .)",
  "foreach 1 as $item (0; .; 1+(1+(1+(1+(1+1)))))",
]) test(`new AST children enforce depth: ${source}`, () => {
  assert.throws(() => evaluation(source, null, { maxAstDepth: 5 }), error => error instanceof JqLimitError);
});

for (const reason of [undefined, null, false, 0, "", new Error("host"), new JqLimitError("maxSteps")]) {
  test(`try preserves thrown host identity: ${String(reason)}`, async context => {
    const { interpreter, iterator } = evaluation("try length catch 99");
    context.mock.method(interpreter, "call", async function* () { yield* []; throw reason; });
    let rejected = false;
    try { await iterator.next(); } catch (actual) { rejected = true; assert.equal(actual, reason); }
    assert.equal(rejected, true);
  });
}

test("try does not catch a JqError used as cancellation reason", async context => {
  const controller = new AbortController();
  const reason = new JqError("cancelled");
  const { interpreter, iterator } = evaluation("try length catch 99", null, {}, controller.signal);
  context.mock.method(interpreter, "call", async function* () { yield* []; controller.abort(reason); throw reason; });
  await assert.rejects(iterator.next(), error => error === reason);
});

for (const source of ["reduce range(100) as $item (0; .+$item)", "foreach range(100) as $item (0; .+$item; empty)"]) {
  test(`loop yields to cancellation during hidden work: ${source}`, async () => {
    const controller = new AbortController();
    const reason = new Error("cancel");
    const { budget, iterator } = evaluation(source, null, {}, controller.signal);
    const tick = budget.tick.bind(budget);
    let ticks = 0;
    budget.tick = async () => { if (++ticks === 30) controller.abort(reason); await tick(); };
    await assert.rejects(drain(iterator), error => error === reason);
  });
}

for (const source of [
  "foreach range(100) as $item (0; .+$item)",
  "try range(100) catch 0", "foreach range(100) as $item (0; .; range(100))",
  "foreach range(100) as $item (range(100); .+$item)",
]) test(`early close retires source and extraction generators: ${source}`, async context => {
  const { interpreter, iterator } = evaluation(source);
  const call = interpreter.call;
  let active = 0;
  let retired = 0;
  let produced = 0;
  context.mock.method(Interpreter.prototype, "call", async function* (this: Interpreter, ...args: Parameters<Interpreter["call"]>) {
    active++;
    try { for await (const value of call.apply(this, args)) { produced++; yield value; } }
    finally { active--; retired++; }
  });
  assert.equal((await iterator.next()).done, false);
  assert.ok(produced <= 2);
  await iterator.return(undefined);
  assert.equal(active, 0);
  assert.ok(retired > 0);
});

test("descent preserves original object and Decimal references", async () => {
  const { budget } = evaluation(".");
  const { parseJson } = await import("../../src/commands/structured/input.js");
  const input = parseJson('{"value":9007199254740993123456789}', budget) as Record<string, Json>;
  const { iterator } = evaluation("..", input);
  assert.equal((await iterator.next()).value, input);
  assert.equal((await iterator.next()).value, input.value);
  assert.equal((await iterator.next()).done, true);
});

test("foreach does not collect source, initializer, update or extract alternatives", async () => {
  const { iterator } = evaluation("first(foreach range(10000) as $item (range(10000); range(10000); range(10000)))", null,
    { maxSteps: 50, maxCollectionSize: 1 });
  assert.deepEqual(await iterator.next(), { done: false, value: 0 });
  assert.equal((await iterator.next()).done, true);
});

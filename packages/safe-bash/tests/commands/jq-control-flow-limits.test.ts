import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget, JqError, JqLimitError, object, objectKeys, put, resolveJqLimits, type JqLimits, type Json } from "../../src/commands/structured/limits.js";
import { compare, stringCompare } from "../../src/commands/structured/values.js";
import { parseJson } from "../../src/commands/structured/input.js";
import { run } from "./structured/helpers.js";
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

function sortEvaluation(source: string, input: Json, limits: Partial<JqLimits> = {}, signal = new AbortController().signal, variables = new Map<string, Json>()) {
  const ast = parse(source, variables, new Budget(resolveJqLimits(), signal));
  const budget = new Budget(resolveJqLimits(limits), signal);
  return { budget, iterator: new Interpreter(budget, variables).run(ast, input) };
}

async function collect(iterator: AsyncGenerator<Json>): Promise<Json[]> {
  const result: Json[] = [];
  for await (const value of iterator) result.push(value);
  return result;
}

async function countNativeSort<Result>(operation: () => Promise<Result>): Promise<{ result: Result; calls: number }> {
  const original = Array.prototype.sort;
  let calls = 0;
  Array.prototype.sort = function (this: unknown[], comparator?: (left: unknown, right: unknown) => number) {
    calls++;
    return original.call(this, comparator);
  };
  try { return { result: await operation(), calls }; }
  finally { Array.prototype.sort = original; }
}

test("jq sort work: keys preserves Unicode ordering without native sort", async () => {
  const input = object();
  for (const key of ["😀", "\ue000", "10", "2", "é", "A"]) put(input, key, null);
  const { iterator } = sortEvaluation("keys", input);
  const { result, calls } = await countNativeSort(() => collect(iterator));
  assert.deepEqual(result, [["10", "2", "A", "é", "\ue000", "😀"]]);
  assert.equal(calls, 0);
  assert.deepEqual(objectKeys(input), ["😀", "\ue000", "10", "2", "é", "A"]);
});

test("jq sort work: comparison never materializes code-point arrays", async context => {
  const materialize = context.mock.method(Array, "from");
  const budget = new Budget(resolveJqLimits(), new AbortController().signal);
  const result = await compare("é".repeat(97) + "\ue000", "é".repeat(97) + "😀", budget);
  const calls = materialize.mock.calls.filter(call => typeof call.arguments[0] === "string").length;
  materialize.mock.restore();
  assert.equal(result, -1);
  assert.equal(calls, 0);
});

test("jq sort work: string scan admission precedes the first code point", async context => {
  const scan = context.mock.method(String.prototype, "codePointAt");
  const signal = new AbortController().signal;
  for (const maxSteps of [1, 4]) {
    await assert.rejects(async () => compare("a".repeat(65), "a".repeat(64) + "b", new Budget(resolveJqLimits({ maxSteps }), signal)),
      error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
  }
  assert.equal(scan.mock.callCount(), 0);
  assert.equal(await compare("a".repeat(65), "a".repeat(64) + "b", new Budget(resolveJqLimits({ maxSteps: 5 }), signal)), -1);
});

test("jq sort work: object comparison refuses before sorting either key list", async context => {
  const scan = context.mock.method(String.prototype, "codePointAt");
  const first = object();
  const second = object();
  for (const key of ["d", "c", "b", "a"]) { put(first, key, 0); put(second, key, 1); }
  const budget = new Budget(resolveJqLimits({ maxSteps: 1 }), new AbortController().signal);
  const { calls } = await countNativeSort(() => assert.rejects(async () => compare(first, second, budget),
    error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded"));
  assert.equal(calls, 0);
  assert.equal(scan.mock.callCount(), 0);
});

test("jq sort work: equal-content strings still admit ordered comparison", async context => {
  const scan = context.mock.method(String.prototype, "codePointAt");
  const budget = new Budget(resolveJqLimits({ maxSteps: 4 }), new AbortController().signal);
  await assert.rejects(async () => compare("a".repeat(65), "a".repeat(65), budget),
    error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
  assert.equal(scan.mock.callCount(), 0);
});

test("jq sort work: key collection refusal precedes comparator scans", async context => {
  const input = { d: 0, c: 0, b: 0, a: 0 };
  const { iterator } = sortEvaluation("keys", input, { maxCollectionSize: 3 });
  const scan = context.mock.method(String.prototype, "codePointAt");
  await assert.rejects(collect(iterator), error => error instanceof JqLimitError && error.message === "maxCollectionSize limit exceeded");
  assert.equal(scan.mock.callCount(), 0);
});

test("jq sort work: larger keys charge proportionally before discarded output", async context => {
  const charges: number[] = [];
  for (const size of [12, 48]) {
    const input = object();
    for (let index = size; index > 0; index--) put(input, `key${index}`, null);
    const { budget, iterator } = sortEvaluation("keys | empty", input);
    const step = context.mock.method(budget, "step");
    assert.deepEqual(await collect(iterator), []);
    charges.push(step.mock.calls.reduce((sum, call) => sum + (call.arguments[0] ?? 1), 0));
  }
  assert.ok(charges[1]! > charges[0]! * 2);
});

test("jq sort work: failed sorting leaves original key order untouched", async () => {
  const input = object();
  const keys = ["h", "g", "f", "e", "d", "c", "b", "a"];
  for (const key of keys) put(input, key, null);
  await assert.rejects(collect(sortEvaluation("keys", input, { maxSteps: 8 }).iterator), error => error instanceof JqLimitError);
  assert.deepEqual(objectKeys(input), keys);
  assert.deepEqual(await collect(sortEvaluation("keys_unsorted", input).iterator), [keys]);
});

test("jq sort work: elapsed yield begins at 25ms and resets after completion", async context => {
  let elapsed = 0;
  context.mock.method(performance, "now", () => elapsed);
  const signal = new AbortController().signal;
  const budget = new Budget(resolveJqLimits(), signal);
  let checkpoints = 0;
  registerYieldCheckpoint(signal, () => { checkpoints++; });
  elapsed = 24; await budget.tick(); assert.equal(checkpoints, 0);
  elapsed = 25; await budget.tick(); assert.equal(checkpoints, 1);
  elapsed = 49; await budget.tick(); assert.equal(checkpoints, 1);
  elapsed = 50; await budget.tick(); assert.equal(checkpoints, 2);
});

test("jq sort work: constant clock retains the 1024-step yield", async context => {
  context.mock.method(performance, "now", () => 0);
  const signal = new AbortController().signal;
  const budget = new Budget(resolveJqLimits(), signal);
  let checkpoints = 0;
  registerYieldCheckpoint(signal, () => { checkpoints++; });
  for (let index = 0; index < 1023; index++) await budget.tick();
  assert.equal(checkpoints, 0);
  await budget.tick(); assert.equal(checkpoints, 1);
});

test("jq sort work: already admitted checkpoints do not charge again", async context => {
  context.mock.method(performance, "now", () => 0);
  const budget = new Budget(resolveJqLimits({ maxSteps: 1 }), new AbortController().signal);
  budget.step();
  await budget.tick(0);
  await budget.tick(0);
  await assert.rejects(budget.tick(), error => error instanceof JqLimitError);
});

for (const reason of [false, null, new JqError("comparison cancellation")]) {
  test(`jq sort work: long comparison cooperates with reason ${String(reason)}`, async context => {
    let elapsed = 0;
    context.mock.method(performance, "now", () => elapsed);
    const original = String.prototype.codePointAt;
    const scan = context.mock.method(String.prototype, "codePointAt", function (this: string, offset: number) {
      elapsed++;
      return original.call(this, offset);
    });
    const controller = new AbortController();
    const budget = new Budget(resolveJqLimits(), controller.signal);
    registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
    await assert.rejects(async () => compare("a".repeat(512) + "b", "a".repeat(512) + "c", budget), error => error === reason);
    assert.ok(scan.mock.callCount() > 0 && scan.mock.callCount() <= 64);
  });

  for (const source of ['try (. < $other) catch "caught"', "(. < $other)?"]) {
    test(`jq sort work: ${source} preserves checkpoint reason ${String(reason)}`, async context => {
      let elapsed = 0;
      context.mock.method(performance, "now", () => elapsed);
      const controller = new AbortController();
      const { iterator } = sortEvaluation(source, "a".repeat(512) + "b", {}, controller.signal, new Map([["other", "a".repeat(512) + "c"]]));
      const original = String.prototype.codePointAt;
      context.mock.method(String.prototype, "codePointAt", function (this: string, offset: number) {
        elapsed++;
        return original.call(this, offset);
      });
      registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
      await assert.rejects(collect(iterator), error => error === reason);
    });
  }
}

test("jq sort work: code-point comparison preserves prefixes and isolated surrogates", async () => {
  const signal = new AbortController().signal;
  for (const [left, right, expected] of [
    ["", "", 0], ["", "a", -1], ["😀", "😀x", -1], ["😀x", "😀", 1],
    ["\ue000", "😀", -1], ["😀", "\ue000", 1], ["é", "é", -1],
    ["\ud800", "\ud801", -1], ["\udc00", "\ud800", 1], ["a😀", "aa", 1],
  ] as const) {
    assert.equal(await stringCompare(left, right, new Budget(resolveJqLimits(), signal)), expected);
  }
});

test("jq sort work: recursive ordering and numeric behavior remain intact", async () => {
  const signal = new AbortController().signal;
  for (const [left, right, expected] of [
    [null, false, -1], [false, true, -1], [true, 0, -1], [0, "", -1], ["", [], -1], [[], {}, -1],
    [[1], [1, 0], -1], [{ b: 0 }, { a: 9 }, 1], [{ a: 0 }, { a: 0, b: 0 }, -1],
    [{ a: { b: 1 } }, { a: { b: 2 } }, -1], [NaN, 0, -1], [0, NaN, 1], [-Infinity, Infinity, -1], [-0, 0, 0],
  ] as [Json, Json, number][]) {
    assert.equal(await compare(left, right, new Budget(resolveJqLimits(), signal)), expected);
  }
  const first = parseJson("10000000000000000000001", new Budget(resolveJqLimits(), signal));
  const second = parseJson("10000000000000000000002", new Budget(resolveJqLimits(), signal));
  assert.equal(await compare(first, second, new Budget(resolveJqLimits(), signal)), -1);
});

for (const source of ["sort", "unique", "group_by(.)", "min", "max"]) {
  test(`jq sort work: ${source} uses cooperative ordering`, async () => {
    const input = [3, 1, 3, 2];
    const expected: Record<string, Json> = { sort: [1, 2, 3, 3], unique: [1, 2, 3], "group_by(.)": [[1], [2], [3, 3]], min: 1, max: 3 };
    const { iterator } = sortEvaluation(source, input);
    const { result, calls } = await countNativeSort(() => collect(iterator));
    assert.deepEqual(result, [expected[source]!]);
    assert.equal(calls, 0);
    assert.deepEqual(input, [3, 1, 3, 2]);
  });
}

test("jq sort work: keyed ties keep stable sort, grouping and min/max selection", async () => {
  const first = { key: 2, label: "first" };
  const middle = { key: 1, label: "middle" };
  const last = { key: 2, label: "last" };
  const { iterator } = sortEvaluation("sort_by(.key),unique_by(.key),group_by(.key),min_by(.key),max_by(.key)", [first, middle, last]);
  const { result, calls } = await countNativeSort(() => collect(iterator));
  assert.deepEqual(result, [[middle, first, last], [middle, first], [[middle], [first, last]], middle, last]);
  assert.equal((result[0] as Json[])[1], first);
  assert.equal(result[4], last);
  assert.equal(calls, 0);
});

test("jq sort work: deletion paths are reverse sorted and deduplicated", async () => {
  for (const [source, input, expected] of [
    [".[1,2,1]|=empty", [0, 1, 2, 3], [0, 3]],
    ["(.a,.a.b)|=empty", { a: { b: 2 } }, {}],
  ] as [string, Json, Json][]) {
    const { iterator } = sortEvaluation(source, input);
    const { result, calls } = await countNativeSort(() => collect(iterator));
    assert.deepEqual(JSON.parse(JSON.stringify(result)), [expected]);
    assert.equal(calls, 0);
  }
});

test("jq sort work: limits cannot be caught or suppressed", async () => {
  for (const source of ['try keys catch "caught"', "keys? | empty", 'try (. < $other) catch "caught"', "(. < $other)?"]) {
    const input = { h: 0, g: 0, f: 0, e: 0, d: 0, c: 0, b: 0, a: 0 };
    const { iterator } = sortEvaluation(source, input, { maxSteps: 8 }, undefined, new Map<string, Json>([["other", { ...input, a: 1 }]]));
    await assert.rejects(collect(iterator), error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
  }
});

test("jq sort work: pre-abort precedes code-point reads and keeps falsey identity", async context => {
  const scan = context.mock.method(String.prototype, "codePointAt");
  for (const reason of [false, null]) {
    const controller = new AbortController();
    controller.abort(reason);
    const budget = new Budget(resolveJqLimits(), controller.signal);
    await assert.rejects(async () => stringCompare("a", "b", budget), error => error === reason);
    await assert.rejects(async () => compare("a", "b", budget), error => error === reason);
  }
  assert.equal(scan.mock.callCount(), 0);
});

test("jq sort work: command retains recursive assignment and join type errors", async () => {
  const merge = await run(["-c", '. *= {"a":{"right":2}}'], '{"a":{"left":1}}');
  assert.equal(merge.exitCode, 0);
  assert.equal(merge.stdout, '{"a":{"left":1,"right":2}}\n');
  for (const source of ['try ([1,2] | join({})) catch .', 'try ([{}] | join(",")) catch .']) {
    const result = await run(["-nc", source]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("cannot be added"));
    assert.equal(result.stderr, "");
  }
});

for (const reason of [false, null, new JqError("command comparison cancellation")]) {
  test(`jq sort work: command comparison preserves ${String(reason)} without output`, async context => {
    let elapsed = 0;
    let scans = 0;
    let writes = 0;
    context.mock.method(performance, "now", () => elapsed);
    const controller = new AbortController();
    const left = "a".repeat(512) + "b";
    const right = "a".repeat(512) + "c";
    const original = String.prototype.codePointAt;
    context.mock.method(String.prototype, "codePointAt", function (this: string, offset: number) {
      if (this === left || this === right) { elapsed++; scans++; }
      return original.call(this, offset);
    });
    registerYieldCheckpoint(controller.signal, () => { if (scans) controller.abort(reason); });
    await assert.rejects(run(["-nc", "--arg", "left", left, "--arg", "right", right, 'try ($left < $right) catch "caught"'], "", {}, {
      signal: controller.signal,
      stdout: { async write() { writes++; } },
      stderr: { async write() { writes++; } },
    }), error => error === reason);
    assert.ok(scans > 0 && scans <= 64);
    assert.equal(writes, 0);
  });
}

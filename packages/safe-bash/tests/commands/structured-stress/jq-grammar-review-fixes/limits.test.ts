import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget, defaultJqLimits, JqLimitError, type Json } from "../../../../src/commands/structured/limits.js";
import { compare, equal } from "../../../../src/commands/structured/values.js";
import { run } from "../../structured/helpers.js";

test("alias ordering descends and charges work; identity equality stays separate", () => {
  for (const value of [[NaN], { value: NaN }, [[NaN]], { value: [NaN] }] satisfies Json[]) {
    const budget = new Budget(defaultJqLimits, new AbortController().signal);
    assert.equal(equal(value, value, budget), true);
    assert.equal(compare(value, value, budget), -1);
  }
  const value: Json = [...Array<number>(32).fill(0), NaN];
  const limited = () => new Budget({ ...defaultJqLimits, maxSteps: 8 }, new AbortController().signal);
  assert.equal(equal(value, value, limited()), true);
  assert.throws(() => compare(value, value, limited()), error => error instanceof JqLimitError && error.message === "maxSteps limit exceeded");
});

test("alias ordering preserves abort identity", () => {
  const reason = new Error("cancel alias comparison");
  const controller = new AbortController();
  controller.abort(reason);
  const value: Json = { nested: [NaN] };
  assert.throws(() => compare(value, value, new Budget(defaultJqLimits, controller.signal)), error => error === reason);
});

test("isfinite arity is rejected before acquiring input", async () => {
  let acquired = 0;
  const input = { [Symbol.asyncIterator]() { acquired++; throw new Error("must not read"); } };
  const result = await run(["-c", "isfinite(.)"], input);
  assert.equal(result.exitCode, 3);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /isfinite/u);
  assert.equal(acquired, 0);
});

test("predicate generators retain result and exact output-byte limits", async () => {
  const result = await run(["-nc", "(nan,infinite,0) | isfinite"], "", { limits: { maxResults: 2 } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "true\nfalse\n");
  assert.equal(result.stderr, "jq: maxResults limit exceeded\n");
  const exact = await run(["-c", "isfinite"], "NaN", { limits: { maxOutputBytes: 5 } });
  assert.equal(exact.exitCode, 0);
  assert.equal(exact.stdout, "true\n");
  const short = await run(["-c", "isfinite?"], "NaN", { limits: { maxOutputBytes: 4 } });
  assert.equal(short.exitCode, 5);
  assert.equal(short.stdout, "");
  assert.equal(short.stderr, "jq: maxOutputBytes limit exceeded\n");
});

test("optional predicate pipelines cannot suppress step exhaustion", async () => {
  const result = await run(["-nc", "(range(10000) | isfinite)?"], "", { limits: { maxSteps: 200 } });
  assert.equal(result.exitCode, 5);
  assert.match(result.stderr, /maxSteps limit exceeded/u);
  assert.ok(result.stdout.length < 50000);
});

test("predicate output backpressure cancellation closes input without reading ahead", async () => {
  const reason = new Error("cancel predicate write");
  const controller = new AbortController();
  let reads = 0;
  let closed = 0;
  let writes = 0;
  let diagnostics = 0;
  const input = (async function* () {
    try { reads++; yield Buffer.from("NaN\n"); reads++; yield Buffer.from("Infinity\n"); }
    finally { closed++; }
  })();
  await assert.rejects(run(["-c", "isfinite"], input, {}, {
    signal: controller.signal,
    stdout: { async write() { writes++; controller.abort(reason); await new Promise<void>(() => {}); } },
    stderr: { async write() { diagnostics++; } },
  }), error => error === reason);
  assert.deepEqual({ reads, closed, writes, diagnostics }, { reads: 1, closed: 1, writes: 1, diagnostics: 0 });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createSafeJsNodeCommand } from "../../../src/commands/node/safejs.js";
import { contractRuntime, execute, operation } from "./helpers.js";

for (const limits of [undefined, { maxOutputBytes: 2 }, { maxSteps: 7 }]) {
  test(`only explicit interpreter limits reach the runtime: ${JSON.stringify(limits)}`, async () => {
    const runtime = contractRuntime(async (_source, options) => {
      assert.deepEqual(options.budget, limits?.maxSteps === undefined ? {} : { maxSteps: 7 });
      await operation(options, "stdio", "write")("ok");
    });
    assert.equal((await execute(["-e", "contract"], { runtime, ...limits === undefined ? {} : { limits } })).exitCode, 0);
  });
}

test("injected Node route leaves unrelated budgets unset", async () => {
  const runtime = contractRuntime(async (_source, options) => {
    assert.deepEqual(options.budget, {});
  });
  const seed = await execute(["-e", "contract"], { runtime });
  assert.equal((await createSafeJsNodeCommand({ runtime, limits: { maxOutputBytes: 10 } }).execute({ ...seed.context, command: "node", args: ["-e", "1"] })).exitCode, 0);
});

test("omitted byte limits accept source and output above the former caps", async () => {
  const source = " ".repeat(1024 * 1024 + 1);
  const output = "x".repeat(8 * 1024 * 1024 + 1);
  const runtime = contractRuntime(async (actual, options) => {
    assert.equal(actual, source);
    await operation(options, "stdio", "write")(output);
  });
  const result = await execute(["-e", source], { runtime });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, output.length);
});

for (const name of ['maxCallDepth', 'stringLength', 'arrayLength', 'dataSize'] as const) test(`individual ${name} leaves other interpreter budgets omitted`, async () => {
  const runtime = contractRuntime(async (_source, options) => { assert.deepEqual(options.budget, { [name]: 20 }); });
  assert.equal((await execute(['-e', 'contract'], { runtime, limits: { [name]: 20 } })).exitCode, 0);
});

test('an explicit timeout can exceed the native timer range', async () => {
  const timeoutMs = 2_147_483_648;
  const started = Date.now();
  const runtime = contractRuntime(async (_source, options) => {
    assert.deepEqual(Object.keys(options.budget), ['deadline']);
    assert(Reflect.get(options.budget, 'deadline') >= started + timeoutMs);
  });
  assert.equal((await execute(['-e', 'contract'], { runtime, limits: { timeoutMs } })).exitCode, 0);
});

test('guest diagnostics are not silently truncated without an output budget', async () => {
  const message = 'x'.repeat(5000);
  const runtime = { ...contractRuntime(async () => {}), async run() { return { ok: false as const, error: { name: 'Error', message } }; } };
  const result = await execute(['-e', 'contract'], { runtime });
  assert.equal(result.stderr, `safejs: ${message}\n`);
});

test('the exported default limits can be supplied directly', async () => {
  const { defaultSafeJsLimits } = await import('../../../src/commands/safejs/options.js');
  const runtime = contractRuntime(async (_source, options) => { assert.deepEqual(options.budget, {}); });
  assert.equal((await execute(['-e', 'contract'], { runtime, limits: defaultSafeJsLimits })).exitCode, 0);
});

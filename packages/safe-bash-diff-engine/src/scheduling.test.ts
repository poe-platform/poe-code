import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { Budget, type DiffPatchOptions } from "./shared.js";

function budgetFor(signal: AbortSignal, options: DiffPatchOptions = {}) {
  return new Budget({
    command: "diff", args: [], cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(""), signal,
    stdout: { async write() { assert.fail("unexpected stdout"); } },
    stderr: { async write() { assert.fail("unexpected stderr"); } },
  }, options);
}

test("advancing clocks throttle later work quanta until 16ms after a host turn", async t => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const budget = budgetFor(new AbortController().signal);
  budget.step(4096);
  const first = budget.checkpoint();
  assert.ok(first instanceof Promise);
  // Host scheduling time must not consume the next computation interval.
  now = 100;
  await first;
  for (const time of [101, 108, 115]) {
    now = time;
    budget.step(4096);
    assert.equal(budget.checkpoint(), undefined);
  }
  now = 116;
  budget.step(4096);
  const next = budget.checkpoint();
  assert.ok(next instanceof Promise);
  await next;
});

for (const clock of ["frozen", "backward"] as const) {
  test(`${clock} clock still services queued cancellation after the first turn`, async t => {
    let now = 100;
    t.mock.method(performance, "now", () => now);
    const controller = new AbortController();
    const budget = budgetFor(controller.signal);
    budget.step(4096);
    await budget.checkpoint();
    if (clock === "backward") now = 99;
    const reason = { clock };
    const turn = setImmediate(() => controller.abort(reason));
    try {
      budget.step(4096);
      const pending = budget.checkpoint();
      assert.ok(pending instanceof Promise);
      await assert.rejects(pending, error => error === reason);
    } finally { clearImmediate(turn); }
  });
}

test("throttled work retains work and byte limits and synchronous cancellation", async t => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const controller = new AbortController();
  const budget = budgetFor(controller.signal, { maxWork: 8192, maxOutputBytes: 2 });
  budget.step(4096);
  await budget.checkpoint();
  now = 1;
  budget.step(4096);
  assert.equal(budget.checkpoint(), undefined);
  assert.throws(() => budget.step(), /work limit exceeded/);
  budget.output("é");
  assert.throws(() => budget.output("x"), /output byte limit exceeded/);
  const reason = { cancellation: "throttled" };
  controller.abort(reason);
  assert.throws(() => budget.checkpoint(), error => error === reason);
});

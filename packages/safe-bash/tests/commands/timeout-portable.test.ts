import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createContext, runInContext } from "node:vm";

test("timeout scheduler browser graph has no Node clock or timer dependency", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../../src/commands/timeout/scheduler.ts", import.meta.url))],
    bundle: true, write: false, metafile: true, platform: "browser", format: "cjs", target: "es2022",
    conditions: ["workerd", "worker", "browser"], logLevel: "silent",
  });
  assert.deepEqual(Object.values(result.metafile!.outputs).flatMap(output => output.imports), []);
  let now = 0;
  let nextHandle = 0;
  let clockCalls = 0;
  const active = new Map<number, () => void>();
  const delays: number[] = [];
  const cleared: number[] = [];
  const performance = { now() { assert.equal(this, performance); clockCalls++; return now; } };
  const sandbox = createContext({
    AbortController, performance,
    setTimeout(this: unknown, callback: () => void, milliseconds: number) {
      assert.equal(this, globalObject);
      delays.push(milliseconds);
      active.set(nextHandle, callback);
      return nextHandle++;
    },
    clearTimeout(this: unknown, handle: number) {
      assert.equal(this, globalObject);
      cleared.push(handle);
      active.delete(handle);
    },
  });
  const globalObject: unknown = runInContext("globalThis", sandbox);
  const scheduler = runInContext(`(function(){ const module = { exports: {} }; ${result.outputFiles![0]!.text}; return module.exports; })()`, sandbox) as typeof import("../../src/commands/timeout/scheduler.js");
  const deadline = scheduler.createDeadline(scheduler.defaultSchedulerBinding, 25, 10);
  deadline.start();
  assert.ok(active.has(0));
  now = 7;
  active.get(0)!();
  now = 20;
  active.get(1)!();
  now = 25;
  active.get(2)!();
  assert.equal(deadline.signal.reason, deadline.deadlineReason);
  assert.deepEqual(delays, [10, 10, 5]);
  const retirement = deadline.retire();
  assert.equal(deadline.retire(), retirement);
  await retirement;
  assert.deepEqual(cleared, [0, 1, 2]);
  assert.equal(active.size, 0);
  const early = scheduler.createDeadline(scheduler.defaultSchedulerBinding, 100, 10);
  early.start();
  const lateWake = active.get(3)!;
  await early.retire();
  const beforeWake = clockCalls;
  lateWake();
  assert.equal(clockCalls, beforeWake);
  assert.equal(early.signal.aborted, false);
  assert.equal(active.size, 0);
});

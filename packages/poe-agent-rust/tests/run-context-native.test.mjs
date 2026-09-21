import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/run-context.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../poe-agent/src/runtime/run-context.ts", import.meta.url);
test("disposal keeps arbitrary failures, retries in reverse order and coalesces", async () => {
  for (const api of [original, own]) {
    const logs = [],
      trace = [],
      reason = Symbol("failure"),
      ctx = api.createRunContext({
        logger: {
          error(...args) {
            logs.push(args);
          }
        },
        activeSkills: [" x ", "x", " ", "y\ud800"]
      });
    assert.deepEqual(ctx.activeSkills, ["x", "y\ud800"]);
    let fail = true,
      release;
    const blocker = new Promise((resolve) => {
      release = resolve;
    });
    ctx.registerDisposeHook(() => {
      trace.push(1);
    });
    ctx.registerDisposeHook(() => {
      trace.push(2);
      if (fail) throw reason;
    });
    ctx.registerDisposeHook(async () => {
      trace.push(3);
      await blocker;
      if (fail) throw undefined;
    });
    const first = ctx.dispose(),
      second = ctx.dispose();
    assert.deepEqual(trace, [3]);
    release();
    const results = await Promise.allSettled([first, second]);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert.deepEqual(result.reason.errors, [undefined, reason]);
    }
    assert.deepEqual(trace, [3, 2, 1]);
    assert.deepEqual(logs, [
      ["Dispose hook failed.", undefined],
      ["Dispose hook failed.", reason]
    ]);
    fail = false;
    await ctx.dispose();
    assert.deepEqual(trace, [3, 2, 1, 3, 2]);
    await ctx.dispose();
    assert.equal(trace.length, 5);
  }
});
test("abort registrations and live children preserve host mutation", async () => {
  for (const api of [original, own]) {
    const trace = [],
      tracker = {
        snapshot() {
          return {};
        }
      };
    const ctx = api.createRunContext({ fileAwareness: tracker });
    assert.equal(ctx.fileAwareness, tracker);
    ctx.abortController.signal.addEventListener("abort", () => {
      trace.push("abort");
      ctx.registerDisposeHook(() => trace.push("listener"));
    });
    ctx.registerDisposeHook(() => {
      trace.push("initial");
      ctx.registerDisposeHook(() => trace.push("late"));
    });
    let release;
    const child = new Promise((resolve) => {
      release = resolve;
    });
    assert.equal(ctx.trackChildRun(child), child);
    ctx.childRuns.add(Promise.resolve());
    assert.equal(ctx.getChildRunCount(), 2);
    await ctx.dispose();
    assert.deepEqual(trace, ["abort", "listener", "initial"]);
    assert.equal(ctx.getChildRunCount(), 0);
    release();
    await child;
    ctx.messages.push({ role: "user", content: "x" });
    assert.equal(ctx.messages.length, 1);
    ctx.session.set("opaque", tracker);
    assert.equal(ctx.session.get("opaque"), tracker);
  }
});
test("logger failure preserves original hooks for retry", async () => {
  for (const api of [original, own]) {
    const trace = [],
      reason = Symbol("logger");
    let fail = true;
    const ctx = api.createRunContext({
      logger: {
        error() {
          if (fail) throw reason;
        }
      }
    });
    ctx.registerDisposeHook(() => trace.push(1));
    ctx.registerDisposeHook(() => {
      trace.push(2);
      if (fail) throw null;
    });
    ctx.registerDisposeHook(() => trace.push(3));
    await assert.rejects(ctx.dispose(), (error) => error === reason);
    assert.deepEqual(trace, [3, 2]);
    fail = false;
    await ctx.dispose();
    assert.deepEqual(trace, [3, 2, 3, 2, 1]);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate } from "node:timers/promises";
const { withOAuthSessionTransaction: own } = await import("../dist/transaction.js");
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const { withOAuthSessionTransaction: original } = await tsImport(
  "../../mcp-oauth/src/client/session-transaction.ts",
  import.meta.url
);
const deferred = () => {
  let resolve;
  return { promise: new Promise((done) => (resolve = done)), resolve: () => resolve() };
};
for (const [name, api] of [
  ["original", original],
  ["Rust", own]
]) {
  test(
    name + " queued cancellation preserves owner and next waiter without leaking listeners",
    async () => {
      const store = {},
        entered = deferred(),
        finish = deferred(),
        events = [],
        controller = new AbortController(),
        reason = { cancelled: true };
      const owner = api(store, "r", async () => {
        events.push("owner");
        entered.resolve();
        await finish.promise;
        return 1;
      });
      await entered.promise;
      const waiter = api(
        store,
        "r",
        async () => {
          events.push("cancelled");
        },
        { signal: controller.signal }
      ).catch((error) => error);
      await setImmediate();
      controller.abort(reason);
      assert.equal(await waiter, reason);
      const next = api(store, "r", async () => {
        events.push("next");
        return 3;
      });
      await setImmediate();
      assert.deepEqual(events, ["owner"]);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
      finish.resolve();
      assert.deepEqual(await Promise.all([owner, next]), [1, 3]);
      assert.deepEqual(events, ["owner", "next"]);
      const marker = { failure: true };
      await assert.rejects(
        api(store, "r", async () => {
          throw marker;
        }),
        (error) => error === marker
      );
      assert.equal(await api(store, "r", async () => 4), 4);
    }
  );
  test(name + " resources run independently and backend locks enclose opaque effects", async () => {
    const blocked = deferred(),
      entered = deferred(),
      events = [],
      store = {
        withLock: async (key, operation, options) => {
          assert.equal(key, "a");
          assert.ok(options.timeoutMs > 0);
          events.push("lock");
          try {
            return await operation();
          } finally {
            events.push("unlock");
          }
        }
      };
    const a = api(store, "a", async () => {
      events.push("operation");
      entered.resolve();
      await blocked.promise;
      return "a";
    });
    await entered.promise;
    assert.equal(await api({}, "b", async () => "b"), "b");
    blocked.resolve();
    assert.equal(await a, "a");
    assert.deepEqual(events, ["lock", "operation", "unlock"]);
  });
  test(name + " timeout cannot release an active owner's transaction", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const store = {},
      entered = deferred(),
      finish = deferred(),
      events = [];
    const owner = api(store, "r", async () => {
      events.push("owner");
      entered.resolve();
      await finish.promise;
      return 1;
    });
    await entered.promise;
    const waiter = api(store, "r", async () => events.push("timed out"), { timeoutMs: 5 }).catch(
      (error) => error
    );
    const next = api(store, "r", async () => {
      events.push("next");
      return 3;
    });
    context.mock.timers.tick(5);
    assert.match((await waiter).message, /transaction lock/);
    assert.deepEqual(events, ["owner"]);
    finish.resolve();
    assert.deepEqual(await Promise.all([owner, next]), [1, 3]);
    assert.deepEqual(events, ["owner", "next"]);
  });
  test(name + " validates wait bounds and honors already aborted opaque reasons", async () => {
    let effects = 0;
    for (const timeoutMs of [0, -1, NaN, Infinity, 1.5, 2147483648])
      await assert.rejects(
        api({}, "r", async () => effects++, { timeoutMs }),
        (error) =>
          error.message ===
          "sessionLockTimeoutMs must be an integer from 1 to 2147483647 milliseconds"
      );
    const controller = new AbortController(),
      reason = Symbol("stop");
    controller.abort(reason);
    await assert.rejects(
      api({}, "r", async () => effects++, { signal: controller.signal }),
      (error) => error === reason
    );
    assert.equal(effects, 0);
  });
}

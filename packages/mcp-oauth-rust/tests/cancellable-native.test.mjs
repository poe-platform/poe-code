import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { waitForOAuthOperation as own } from "../dist/index.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const { waitForOAuthOperation: original } = await tsImport(
  "../../mcp-oauth/src/client/cancellable-operation.ts",
  import.meta.url
);
test("cancellable host operations release listeners and keep completion observed", async () => {
  for (const wait of [original, own]) {
    assert.equal(await wait(Promise.resolve("result")), "result");
    const controller = new AbortController(),
      reason = { opaque: "cancel" };
    let reject;
    const pending = new Promise((_, failed) => {
      reject = failed;
    });
    const observed = wait(pending, controller.signal).catch((error) => error);
    assert.equal(getEventListeners(controller.signal, "abort").length, 1);
    controller.abort(reason);
    assert.equal(await observed, reason);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    reject(new Error("late completion"));
    await new Promise((resolve) => setImmediate(resolve));
    const success = new AbortController();
    assert.equal(await wait(Promise.resolve(42), success.signal), 42);
    assert.equal(getEventListeners(success.signal, "abort").length, 0);
    const failure = new Error("host failure"),
      failed = new AbortController();
    await assert.rejects(
      wait(Promise.reject(failure), failed.signal),
      (error) => error === failure
    );
    assert.equal(getEventListeners(failed.signal, "abort").length, 0);
  }
});

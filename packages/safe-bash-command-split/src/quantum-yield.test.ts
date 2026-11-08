import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget } from "./io.js";
import { settings } from "./options.js";

test("split yields at the first and later frozen-clock quanta", async context => {
  context.mock.method(performance, "now", () => 0);
  context.mock.method(Date, "now", () => 0);
  const controller = new AbortController();
  const budget = new Budget(settings({}), controller.signal);
  for (let i = 0; i < 3; i++) {
    let observed = false;
    const host = setImmediate(() => { observed = true; });
    context.after(() => clearImmediate(host));
    await budget.step(65536);
    assert.equal(observed, true);
  }
  const reason = new Error("cancel later quantum");
  const host = setImmediate(() => controller.abort(reason));
  context.after(() => clearImmediate(host));
  await assert.rejects(Promise.resolve().then(() => budget.step(65536)), error => error === reason);
});

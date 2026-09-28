import assert from "node:assert/strict";
import { test } from "node:test";
import { yieldTurn } from "safe-bash-contracts/yield";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";

for (const fallback of [false, true]) {
  test(`XML yields every frozen-clock quantum, timer fallback=${fallback}`, async context => {
    context.mock.method(performance, "now", () => 0);
    context.mock.method(Date, "now", () => 0);
    if (fallback) {
      const immediate = globalThis.setImmediate;
      Reflect.deleteProperty(globalThis, "setImmediate");
      context.after(() => { globalThis.setImmediate = immediate; });
    }
    const budget = new XmlBudget(resolveXmlQueryLimits(), new AbortController().signal, yieldTurn);
    for (let quantum = 0; quantum < 3; quantum++) {
      let observed = false;
      if (fallback) {
        const host = setTimeout(() => { observed = true; }, 0);
        context.after(() => clearTimeout(host));
      } else {
        const host = setImmediate(() => { observed = true; });
        context.after(() => clearImmediate(host));
      }
      const pending = budget.tick(16384);
      assert.ok(pending instanceof Promise);
      await pending;
      assert.equal(observed, true);
    }
  });
}

test("XML later host cancellation retains its exact reason", async context => {
  context.mock.method(performance, "now", () => 0);
  context.mock.method(Date, "now", () => 0);
  const controller = new AbortController();
  const budget = new XmlBudget(resolveXmlQueryLimits(), controller.signal, yieldTurn);
  await budget.tick(16384);
  const host = setImmediate(() => controller.abort(false));
  context.after(() => clearImmediate(host));
  await assert.rejects(async () => { await budget.tick(16384); }, error => error === false);
});

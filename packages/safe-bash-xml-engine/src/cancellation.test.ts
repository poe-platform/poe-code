import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";

test("completed XML budgets retain no listeners on a reusable caller signal", () => {
  const controller = new AbortController();
  for (let invocation = 0; invocation < 20; invocation++) {
    const budget = new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {});
    budget.tick();
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

for (const reason of [false, null, new Error("cancelled")]) {
  test(`XML budget observes cancellation between synchronous ticks: ${String(reason)}`, () => {
    const controller = new AbortController();
    const budget = new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {});
    budget.tick();
    controller.abort(reason);
    assert.throws(() => budget.tick(), error => error === reason);
  });
}

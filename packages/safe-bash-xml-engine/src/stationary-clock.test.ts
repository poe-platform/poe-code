import assert from "node:assert/strict";
import test from "node:test";
import { yieldTurn } from "safe-bash-contracts/yield";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";
test("budget keeps yielding when the clock is stationary", async () => {
  const controller = new AbortController();
  const clock = Object.getOwnPropertyDescriptor(globalThis, "performance");
  const immediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => 0 } });
  Object.defineProperty(globalThis, "setImmediate", { configurable: true, value: undefined });
  try {
    const budget = new XmlBudget(resolveXmlQueryLimits(), controller.signal, yieldTurn);
    const first = budget.tick(16384);
    if (first) await first;
    let turns = 0;
    for (let i = 0; i < 512; i++) { const pending = budget.tick(16384); if (pending) { await pending; turns++; } }
    assert.ok(turns >= 2, "bounded work must schedule repeated macrotasks");
  } finally {
    Object.defineProperty(globalThis, "performance", clock!);
    Object.defineProperty(globalThis, "setImmediate", immediate!);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { Budget, settings } from "./internal.js";
import type { CommandContext } from "safe-bash-contracts";
test("budget keeps yielding when the clock is stationary", async () => {
  const controller = new AbortController();
  const clock = Object.getOwnPropertyDescriptor(globalThis, "performance");
  const immediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => 0 } });
  Object.defineProperty(globalThis, "setImmediate", { configurable: true, value: undefined });
  try {
    const budget = new Budget({} as CommandContext, settings({}), controller.signal, controller.signal, { closed: false });
    const first = budget.step(1024);
    if (first) await first;
    let turns = 0;
    for (let i = 0; i < 512; i++) { const pending = budget.step(1024); if (pending) { await pending; turns++; } }
    assert.ok(turns >= 2, "bounded work must schedule repeated macrotasks");
  } finally {
    Object.defineProperty(globalThis, "performance", clock!);
    Object.defineProperty(globalThis, "setImmediate", immediate!);
  }
});

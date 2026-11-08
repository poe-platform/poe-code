import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { CsvBudget } from "./index.js";

test("disposed CSV budgets release abort listeners on a reusable signal", () => {
  const controller = new AbortController();
  for (let i = 0; i < 20; i++) {
    const budget = new CsvBudget({}, controller.signal);
    budget.dispose();
    budget.dispose();
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

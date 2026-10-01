import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { ColumnBudget } from "./internal.js";
import { settings } from "./options.js";

test("budgets retain no listeners and observe cancellation", () => {
  const controller = new AbortController();
  const context = { signal: controller.signal, args: [] } as unknown as CommandContext;
  const budget = new ColumnBudget(context, settings({}));
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const reason = new Error("cancel");
  controller.abort(reason);
  assert.throws(() => budget.step(), error => error === reason);
});

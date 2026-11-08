import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { WalkBudget } from "./io.js";
import { settings as treeSettings } from "./options.js";

test("tree releases abort subscriptions after success, failure and cancellation", async () => {
  const controller = new AbortController();
  const budget = new WalkBudget({ signal: controller.signal } as CommandContext, treeSettings({}));
  await budget.fs(async () => 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await assert.rejects(budget.fs(async () => { throw new Error("failure"); }));
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const pending = budget.fs(() => new Promise(() => {}));
  controller.abort(new Error("cancel"));
  await assert.rejects(pending, /cancel/);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

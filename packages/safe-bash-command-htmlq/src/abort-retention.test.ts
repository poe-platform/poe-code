import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { HtmlBudget, invocationOptions } from "./contracts.js";

test("shared HTML ledgers observe cancellation without retaining signal listeners", () => {
  const controller = new AbortController();
  const options = invocationOptions({ signal: controller.signal, limits: {
    inputBytes: Infinity, decodedBytes: Infinity, retainedBytes: Infinity, nodes: Infinity,
    attributes: Infinity, depth: Infinity, tokenBytes: Infinity, work: Infinity, outputBytes: Infinity
  } });
  const first = new HtmlBudget(options);
  const second = new HtmlBudget(options);
  first.check();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  controller.abort();
  assert.throws(() => first.check(), { code: "E_CANCELLED" });
  assert.throws(() => second.check(), { code: "E_CANCELLED" });
});

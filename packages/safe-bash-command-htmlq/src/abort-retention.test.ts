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

test("HTML budgets default omitted limits and preserve partial invocation limits", () => {
  const signal = new AbortController().signal;
  for (const options of [{ signal }, { signal, limits: { inputBytes: 4096 } }]) {
    const direct = new HtmlBudget(options);
    assert.equal(direct.limits.outputBytes, Infinity);
    const shared = invocationOptions(options);
    const first = new HtmlBudget(shared);
    first.charge("inputBytes", 4);
    assert.equal(new HtmlBudget(shared).snapshot().inputBytes, 4);
    if (options.limits) assert.throws(() => first.charge("inputBytes", 4096), { code: "E_LIMIT" });
  }
  assert.throws(() => new HtmlBudget(invocationOptions({ signal, limits: { work: -1 } })), { code: "E_LIMIT" });
  assert.equal(getEventListeners(signal, "abort").length, 0);
});

test("HTML operations accept partial limits without retaining listeners on success or failure", async () => {
  const { parseHtml, selectHtml, serializeHtml } = await import("./index.js");
  const signal = new AbortController().signal;
  async function* input() { yield new TextEncoder().encode("<p>Hello</p>"); }
  for (let i = 0; i < 12; i++) {
    const document = await parseHtml(input(), { signal });
    const selected = [...selectHtml(document, "p", { signal, limits: { work: 10000 } })];
    assert.equal(serializeHtml(selected[0]!, { signal }), "<p>Hello</p>");
    assert.throws(() => serializeHtml(document, { signal, limits: { outputBytes: 1 } }), { code: "E_LIMIT" });
    await assert.rejects(parseHtml(input(), { signal, limits: { inputBytes: 1 } }), { code: "E_LIMIT" });
  }
  assert.equal(getEventListeners(signal, "abort").length, 0);
});

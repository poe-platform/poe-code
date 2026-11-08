import assert from "node:assert/strict";
import test from "node:test";
import { serialize, serializeSimpleSync, type Node } from "./evaluate.js";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";

const node: Node = { kind: "text", value: { kind: "text", text: "a".repeat(1000) } };

test("synchronous serialization leaves checkpoint work for the awaited fallback", async () => {
  let calls = 0;
  let release!: () => void;
  const budget = new XmlBudget(resolveXmlQueryLimits({ maxSteps: 17001 }), new AbortController().signal, () => {
    calls++;
    return new Promise<void>(resolve => { release = resolve; });
  });
  budget.tick(16000);
  assert.equal(serializeSimpleSync(node, budget), undefined);
  assert.equal(calls, 0);
  const iterator = serialize(node, budget);
  let settled = false;
  const pending = iterator.next().then(result => { settled = true; return result; });
  assert.equal(calls, 1);
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  assert.deepEqual(await pending, { value: node.value.text, done: false });
  assert.equal((await iterator.next()).done, true);
  assert.throws(() => budget.tick(), /maxSteps/);
});

test("fallback propagates the checkpoint rejection", async () => {
  const failure = new Error("checkpoint aborted");
  const budget = new XmlBudget(resolveXmlQueryLimits(), new AbortController().signal, async () => { throw failure; });
  budget.tick(16000);
  assert.equal(serializeSimpleSync(node, budget), undefined);
  await assert.rejects(serialize(node, budget).next(), error => error === failure);
});

test("synchronous serialization charges once and observes limits and cancellation", () => {
  const controller = new AbortController();
  const budget = new XmlBudget(resolveXmlQueryLimits({ maxSteps: 1001 }), controller.signal, async () => { assert.fail("Unexpected checkpoint"); });
  assert.equal(serializeSimpleSync(node, budget), node.value.text);
  assert.throws(() => serializeSimpleSync(node, budget), /maxSteps/);
  const failure = new Error("aborted");
  controller.abort(failure);
  assert.throws(() => serializeSimpleSync(node, budget), error => error === failure);
});

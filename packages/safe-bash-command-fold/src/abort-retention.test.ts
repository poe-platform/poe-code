import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { createFoldEngine, parseFoldArguments } from "./index.js";

test("fold releases abort listeners on disposal and failure", () => {
  const controller = new AbortController();
  const limits = { inputBytes: 0, outputBytes: 100, work: 100, retainedBytes: 8196, argumentBytes: 4096 };
  for (const fail of [false, true]) {
    const engine = createFoldEngine(parseFoldArguments([], limits), "C", limits, controller.signal);
    if (fail) assert.throws(() => engine.push(Uint8Array.of(97)));
    else engine.dispose();
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    engine.dispose();
  }
});

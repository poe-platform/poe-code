import assert from "node:assert/strict";
import test from "node:test";
import {indentLlmText} from "./indent-text.js";

test("indentation yields during empty sources so cancellation can retire them", async () => {
  const controller = new AbortController(); let closed = 0;
  setImmediate(() => controller.abort(new Error("stop empty input")));
  await assert.rejects(async () => {
    for await (const text of indentLlmText({async *[Symbol.asyncIterator]() {
      try {
        for (let index = 0; index < 1024; index++) yield new Uint8Array();
        throw new Error("empty input starved cancellation");
      } finally {closed++;}
    }}, controller.signal)) assert.equal(text, "");
  }, {message: "stop empty input"});
  assert.equal(closed, 1);
});

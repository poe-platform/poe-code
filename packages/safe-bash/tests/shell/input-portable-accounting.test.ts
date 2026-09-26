import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareBytesInput, inputBufferUsage } from "../../src/shell/input.js";
import { Budget, resolveLimits } from "../../src/shell/runtime.js";

test("string input admission uses portable UTF-8 accounting and releases its buffer", async context => {
  const budget = new Budget(resolveLimits({ maxInputBytes: 5 }));
  context.after(() => budget.close());
  context.mock.method(Buffer, "byteLength", () => { throw new Error("Node byte counting unavailable"); });
  const input = prepareBytesInput("é\ud800", budget);
  assert.deepEqual(inputBufferUsage(budget), { bytes: 5, buffers: 1 });
  const chunks: Uint8Array[] = [];
  for await (const chunk of input.source) chunks.push(chunk);
  assert.deepEqual(chunks, [new TextEncoder().encode("é\ud800")]);
  await input.close();
  assert.deepEqual(inputBufferUsage(budget), { bytes: 0, buffers: 0 });
});

test("oversized UTF-8 input fails admission before allocating encoded bytes", context => {
  const budget = new Budget(resolveLimits({ maxInputBytes: 5 }));
  context.after(() => budget.close());
  context.mock.method(Buffer, "byteLength", () => { throw new Error("Node byte counting unavailable"); });
  context.mock.method(TextEncoder.prototype, "encode", () => { throw new Error("Allocation before admission"); });
  assert.throws(() => prepareBytesInput("ééé", budget), { code: "EFBIG" });
  assert.deepEqual(inputBufferUsage(budget), { bytes: 0, buffers: 0 });
});

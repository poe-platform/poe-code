import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareBytesInput, inputBufferUsage } from "../../src/shell/input.js";
import { Budget, resolveLimits } from "../../src/shell/runtime.js";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

test("optimized discarded output counts UTF-8 bytes without Node Buffer", async context => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  context.after(() => shell.dispose());
  context.mock.method(Buffer, "byteLength", () => { throw new Error("Node byte counting unavailable"); });
  const source = 'for ((i=0;i<3;i++)); do echo "é😀"; done >/dev/null';
  const result = await shell.exec(source, { limits: { maxOutputBytes: 21 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  await assert.rejects(shell.exec(source, { limits: { maxOutputBytes: 20 } }), { message: "Shell limit exceeded: maxOutputBytes" });
});

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

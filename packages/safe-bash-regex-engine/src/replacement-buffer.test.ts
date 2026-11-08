import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget } from "./text/budget.js";
import { ReplacementBuffer } from "./text/replacement-buffer.js";
import type { CommandContext } from "safe-bash-contracts";

for (const limit of [4096, Infinity]) {
  test(`replacement preserves Unicode without Buffer with limit ${limit}`, async () => {
    const original = globalThis.Buffer;
    Reflect.deleteProperty(globalThis, "Buffer");
    try {
      const budget = new Budget({ signal: new AbortController().signal } as CommandContext, { maxBufferBytes: limit });
      const buffer = new ReplacementBuffer(budget);
      const text = "a".repeat(1023) + "🌍 — α 中文\ud800";
      await buffer.append(text);
      await buffer.append("prefix-suffix", 7);
      assert.equal(await buffer.finish(), text + "suffix");
      assert.equal(buffer.remaining, limit);
      if (limit !== Infinity) await assert.rejects(buffer.append("x".repeat(limit + 1)), /buffer limit/);
    } finally { globalThis.Buffer = original; }
  });
}

for (const text of ["x".repeat(64), "\u00ff".repeat(64), "\u0100".repeat(32), "\ud800".repeat(32), "\u0100" + "x".repeat(62), "\u0100x".repeat(21) + "x"]) {
  test(`replacement bounds physical backing for ${JSON.stringify(text.slice(0, 4))} (${text.length} units)`, async context => {
    const allocations: number[] = [];
    for (const name of ["Uint8Array", "Uint16Array"] as const) {
      context.mock.method(globalThis, name, new Proxy(globalThis[name], {
        construct(target, args) {
          const segment = Reflect.construct(target, args) as Uint8Array | Uint16Array;
          allocations.push(segment.buffer.byteLength);
          assert.ok(allocations.reduce((sum, bytes) => sum + bytes, 0) <= 64);
          return segment;
        },
      }));
    }
    const buffer = new ReplacementBuffer(new Budget({ signal: new AbortController().signal } as CommandContext, { maxBufferBytes: 64 }));
    await buffer.append(text);
    assert.equal(await buffer.finish(), text);
    assert.equal(buffer.remaining, 64);
  });
}

test("replacement admits wide storage before allocation and resets physical capacity on clear", async context => {
  const allocate = context.mock.method(globalThis, "Uint16Array");
  const buffer = new ReplacementBuffer(new Budget({ signal: new AbortController().signal } as CommandContext, { maxBufferBytes: 64 }));
  await assert.rejects(buffer.append("\u0100".repeat(33)), { message: "text buffer limit exceeded" });
  assert.equal(allocate.mock.calls.length, 0);
  buffer.clear();
  await buffer.append("x".repeat(63));
  await assert.rejects(buffer.append("\ud800"), { message: "text buffer limit exceeded" });
  assert.equal(allocate.mock.calls.length, 0);
  buffer.clear();
  await buffer.append("\u00ff".repeat(64));
  assert.equal(await buffer.finish(), "\u00ff".repeat(64));
});

test("replacement preserves width transitions and split surrogate pairs across segments", async () => {
  const buffer = new ReplacementBuffer(new Budget({ signal: new AbortController().signal } as CommandContext, { maxBufferBytes: 1031 }));
  await buffer.append("x".repeat(1025));
  await buffer.append("\ud83c");
  await buffer.append("\udf0d\u00ff\u00ff");
  assert.equal(await buffer.finish(), "x".repeat(1025) + "🌍\u00ff\u00ff");
});

test("replacement observes host cancellation during repeated one-unit appends", async () => {
  const controller = new AbortController();
  const buffer = new ReplacementBuffer(new Budget({ signal: controller.signal } as CommandContext, { maxBufferBytes: 4096 }));
  const abort = setImmediate(() => controller.abort(0));
  try {
    await assert.rejects(async () => {
      for (let index = 0; index < 4096; index++) await buffer.append("x");
    }, error => error === 0);
    assert.ok(buffer.remaining > 0 && buffer.remaining < 4096);
  } finally {
    clearImmediate(abort);
    buffer.clear();
  }
  assert.equal(buffer.remaining, 4096);
});

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

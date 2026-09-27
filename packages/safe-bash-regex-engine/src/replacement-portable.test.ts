import assert from "node:assert/strict";
import { test } from "node:test";
import { ReplacementBuffer } from "./text/replacement-buffer.js";
import { Budget } from "./text/budget.js";

test("finite replacement staging preserves all latin1 bytes without Buffer", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true });
  try {
    const budget = new Budget({ signal: new AbortController().signal } as ConstructorParameters<typeof Budget>[0], { maxBufferBytes: 4096 });
    const buffer = new ReplacementBuffer(budget);
    const text = Array.from({ length: 256 }, (_, index) => String.fromCharCode(index)).join("").repeat(9);
    await buffer.append(text);
    assert.equal(await buffer.finish(), text);
    await assert.rejects(buffer.append("x".repeat(4097)), /limit/);
  } finally { Object.defineProperty(globalThis, "Buffer", descriptor); }
});

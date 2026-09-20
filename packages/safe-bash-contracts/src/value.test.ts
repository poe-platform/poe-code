import assert from "node:assert/strict";
import test from "node:test";
import { shellValueByteLength } from "./value.js";

test("canonical string byte accounting works without a Node Buffer global", () => {
  const saved = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined as unknown as typeof Buffer;
    for (const text of ["", "ascii", "é", "漢", "😀", "\ud800", "\udc00", "\ud800a", "\uFEFF"]) {
      assert.equal(shellValueByteLength(text), new TextEncoder().encode(text).byteLength);
    }
  } finally { globalThis.Buffer = saved; }
});

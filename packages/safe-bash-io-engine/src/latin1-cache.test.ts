import assert from "node:assert/strict";
import { test } from "node:test";
import { getCachedLatin1Batch } from "./commands/text-programs/shared.js";

test("a consumer cannot poison a later batch through retained line offsets", () => {
  const input = new TextEncoder().encode("first\n" + "x".repeat(300) + "\n");
  const first = getCachedLatin1Batch(input)!;
  first.ends[0] = 100;
  const next = getCachedLatin1Batch(input)!;
  assert.equal(next.ends[0], 5);
});

test("Latin-1 batches validate unsampled bytes after input mutation", () => {
  const chunk = new TextEncoder().encode("line0\nSECRET_TENANT_ONE\n" + "padding_line_1234567890\n".repeat(20));
  const first = getCachedLatin1Batch(chunk)!;
  chunk.set(new TextEncoder().encode("NEW_TENANT_TWO!!!"), 6);
  const second = getCachedLatin1Batch(chunk)!;
  assert.ok(second.text.includes("NEW_TENANT_TWO!!!"));
  assert.ok(first.text.includes("SECRET_TENANT_ONE"));
});

test("independent inputs do not share mutable batch cache records", () => {
  const chunk = new TextEncoder().encode("line0\n".repeat(100));
  const first = getCachedLatin1Batch(chunk)!;
  const second = getCachedLatin1Batch(chunk.slice())!;
  first.ends.fill(0);
  assert.equal(second.ends[0], 5);
});

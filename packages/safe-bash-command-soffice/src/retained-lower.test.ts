import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { retainLower } from "./retained-lower.js";

for (const width of [1, 7, 16384]) it(`preserves native Unicode lowercase across ${width}-byte chunks`, async () => {
  const fs = new MemoryFileSystem(), signal = new AbortController().signal;
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal});
  const samples = ["ΟΣ", "ΣΣ", "AΣA", "AΣ'", "AΣ'B", "Σ", "İ", "AΣ" + "'".repeat(17000), "AΣ" + "\u0301".repeat(17000) + "B"];
  for (const char of ["ª", "º", "\u0345", "\u200d", "\u02b0", ":", ".", "-", "🙂", "ᾈ", "𐐀"]) samples.push("AΣ" + char, "AΣ" + char + "B", char + "Σ", "A" + char + "Σ");
  try {
    for (const sample of samples) {
      const bytes = new TextEncoder().encode(sample);
      const result = await retainLower(storage, (async function* () { for (let at = 0; at < bytes.length; at += width) yield bytes.subarray(at, at + width); })(), signal);
      let actual = ""; const decoder = new TextDecoder();
      for (let at = 0; at < result.size; at += 16384) actual += decoder.decode(await storage.read(result.position + at, Math.min(16384, result.size - at)), {stream: true});
      actual += decoder.decode(); assert.equal(actual, sample.toLowerCase());
    }
  } finally { await storage.close(); }
  assert.deepEqual(await fs.readdir("/"), []);
});

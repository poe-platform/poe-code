import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { byteChunks, convert } from "../helpers.js";

const cases = ["CASES.json", "NESTED.json"].flatMap(name => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8")) as { id: string; input: string; markdown: string }[]);
for (const entry of cases) test(`semantic inline normalization: ${entry.id}`, async () => {
  for (const size of [1, 7, 4096]) {
    const result = await convert(byteChunks(entry.input, size));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, entry.markdown);
  }
});

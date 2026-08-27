import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Vector } from "../jq-42-independent-review/harness.js";
import { execute } from "../../../stress/harness-timing-20260827/scan-execution.js";
const { vectors } = JSON.parse(readFileSync(new URL("native-boundary-frozen.json", import.meta.url), "utf8")) as { vectors: Vector[] };
for (const vector of vectors) test(`internal scan boundary: ${vector.id}`, { timeout: 120000 }, async () => {
  for (const route of ["direct", "shell"] as const) for (const transport of ["whole", "bytewise", ...[1, 2, 3, 16381, 16382, 16383, 16384, 16385, 16386].map(offset => `split:${offset}`)]) {
    assert.deepEqual(await execute(vector, route, transport), vector.expected, `${route} ${transport}`);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Vector } from "../jq-42-independent-review/harness.js";
import { execute } from "./harness.js";

const cohorts = ["native-frozen.json", "native-extra-frozen.json", "native-equality-frozen.json", "native-context-frozen.json", "native-files-frozen.json", "native-arithmetic-frozen.json", "native-nonfinite-bounds-frozen.json"];
for (const cohort of cohorts) {
  const { vectors } = JSON.parse(readFileSync(new URL(cohort, import.meta.url), "utf8")) as { vectors: Vector[] };
  for (const vector of vectors) test(`${cohort}: ${vector.id}`, { timeout: 10000 }, async () => {
    const transports = ["whole", "bytewise"];
    for (let boundary = 1; boundary < vector.inputHex.length / 2; boundary++) transports.push(`split:${boundary}`);
    for (const route of ["direct", "shell"] as const) for (const transport of transports) {
      assert.deepEqual(await execute(vector, route, transport), vector.expected, `${route} ${transport}`);
    }
  });
}

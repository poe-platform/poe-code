import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transports } from "../jq-42-independent-review/evidence.mjs";
import { loadPublicHarness, type Vector } from "../jq-42-independent-review/harness.js";

const evidence = JSON.parse(readFileSync(new URL("./native-frozen.json", import.meta.url), "utf8")) as { cases: Vector[] };
const execute = await loadPublicHarness();
for (const vector of evidence.cases) for (const route of ["direct", "shell"] as const) {
  test(`nearby ${vector.id} ${route} all chunk boundaries`, async () => {
    for (const transport of transports(vector)) assert.deepEqual((await execute(vector, route, transport)).actual, vector.expected, transport);
  });
}

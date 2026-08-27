import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Vector } from "../../commands/structured-stress/jq-42-independent-review/harness.js";
import { execute } from "./scan-execution.js";

const { vectors } = JSON.parse(readFileSync(new URL("../../commands/structured-stress/jq-grammar-author-20260827/native-boundary-frozen.json", import.meta.url), "utf8")) as { vectors: Vector[] };
for (const vector of vectors) for (const route of ["direct", "shell"] as const) for (const transport of ["whole", "bytewise", ...[1, 2, 3, 16381, 16382, 16383, 16384, 16385, 16386].map(offset => `split:${offset}`)]) {
  assert.deepEqual(await execute(vector, route, transport, 1500), vector.expected, `${vector.id} ${route} ${transport}`);
}
console.log("instrumented original execution budget: 330 exact triples");

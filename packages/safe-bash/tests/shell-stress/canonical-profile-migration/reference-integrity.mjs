import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { primaryObservation } from "./primary-reference.ts";

const metadata = JSON.parse(readFileSync(new URL("./primary-fixtures.json", import.meta.url)));
const original = metadata.fixtures[0].fixture;
const mutations = [
  ["name", { ...original, name: original.name + "-changed" }],
  ["source-newline", { ...original, script: original.script + "\n" }],
  ["stdin", { ...original, stdin: "changed" }],
  ["files", { ...original, initialFiles: { unexpected: "changed" } }],
  ["environment", { ...original, env: { VALUE: "changed" } }],
  ["limits", { ...original, limits: { maxCommands: 1 } }],
];
for (const [name, fixture] of mutations) await assert.rejects(primaryObservation(fixture), { code: "ERR_ASSERTION" }, name);
const first = await primaryObservation(original);
const frozen = await primaryObservation(original);
first.stdout = "caller mutation";
assert.deepEqual(await primaryObservation(original), frozen);
console.log(JSON.stringify({ rejectedMutations: mutations.map(([name]) => name), independentReturnedCopy: true, productExecuted: false }));

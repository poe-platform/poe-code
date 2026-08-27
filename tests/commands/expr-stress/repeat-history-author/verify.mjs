import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const baseline = JSON.parse(readFileSync(new URL("baseline.json", import.meta.url), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const inventory = directory => readdirSync(resolve(root, directory)).flatMap(name => {
  const path = resolve(root, directory, name);
  assert.equal(lstatSync(path).isSymbolicLink(), false, path);
  return lstatSync(path).isDirectory() ? inventory(relative(root, path)) : [relative(root, path)];
}).sort();
for (const [directory, expected] of Object.entries(baseline.historicalTrees)) {
  assert.deepEqual(inventory(directory), Object.keys(expected).sort(), `entry set: ${directory}`);
  for (const [path, digest] of Object.entries(expected)) assert.equal(hash(readFileSync(resolve(root, path))), digest, path);
}
assert.equal(baseline.originalEight.rows.length, 8);
assert.equal(baseline.historicalProjection.originalFailures, 5);
assert.equal(baseline.historicalProjection.projectedAgreements, 4);
assert.deepEqual(baseline.regressions.map(row => row.id), ["mandatory-no-reference", "alternation-longest"]);
console.log(JSON.stringify({ verified: true, original: 8, originalFailures: 5, historicalProjectionOnly: "4/5", retainedRegressions: 2, appendDetection: "all three historical trees" }));

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = new URL("../../../../", import.meta.url);
const candidate = JSON.parse(readFileSync(new URL("candidate-source.json", import.meta.url), "utf8"));
for (const [path, expected] of Object.entries(candidate.hashes)) {
  const actual = createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex");
  assert.equal(actual, expected, `trim candidate source/fixture mismatch: ${path}`);
}
console.log(`TRIM BINDING verified ${Object.keys(candidate.hashes).length} hashes; codeCommit=${candidate.codeCommit}; exact unchanged original20; historical baseline remains 17/20`);

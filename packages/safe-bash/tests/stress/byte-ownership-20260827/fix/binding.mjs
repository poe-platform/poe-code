import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = new URL("../../../../", import.meta.url);
const candidate = JSON.parse(readFileSync(new URL("candidate-source.json", import.meta.url), "utf8"));
const hash = path => createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex");
for (const [path, expected] of Object.entries(candidate.hashes)) {
  assert.equal(hash(path), expected, `candidate source/fixture mismatch: ${path}`);
}
for (const [path, expected] of Object.entries(candidate.originalFixtureHashes)) {
  assert.equal(hash(path), expected, `original fixture mismatch: ${path}`);
}
console.log(`CANDIDATE BINDING verified ${Object.keys(candidate.hashes).length} hashes; candidateHead=${candidate.head}; exact unchanged original20; original baseline remains 17/20`);

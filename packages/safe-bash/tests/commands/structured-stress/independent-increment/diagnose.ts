import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allVectors, digest, executeVector, expectedBytes, supplementBytes, supplementHash, supplementVectors, vectorBytes, vectorHash } from "./harness.js";

assert.equal(digest(vectorBytes), vectorHash);
assert.equal(digest(supplementBytes), supplementHash);
const selected = process.argv[2] === "--case" ? allVectors.filter(vector => vector.id === process.argv[3]) : process.argv[2] === "--freeze-supplement" ? supplementVectors : allVectors;
assert.ok(selected.length);
const results = [];
for (const vector of selected) {
  const expected = expectedBytes(vector);
  const actual = await executeVector(vector);
  const differingFields = (Object.keys(expected) as (keyof typeof expected)[]).filter(key => expected[key] !== actual[key]);
  results.push({ id: vector.id, category: vector.category, classification: differingFields.length === 0 ? "exact" : differingFields.every(key => key === "stderrHex") ? "diagnostic-only" : "semantic", differingFields, expected, actual });
}
const counts = { cases: results.length, exact: 0, semantic: 0, "diagnostic-only": 0 };
const categories: Record<string, { cases: number; exact: number; semantic: number; "diagnostic-only": number }> = {};
for (const result of results) {
  counts[result.classification as "exact" | "semantic" | "diagnostic-only"]++;
  const category = categories[result.category] ??= { cases: 0, exact: 0, semantic: 0, "diagnostic-only": 0 };
  category.cases++;
  category[result.classification as "exact" | "semantic" | "diagnostic-only"]++;
}
const sourceHashes: Record<string, string> = {};
for (const name of ["input.ts", "jq.ts", "interpreter.ts", "parser.ts", "limits.ts", "values.ts", "numbers.ts"]) sourceHashes[name] = digest(readFileSync(new URL(`../../../../src/commands/structured/${name}`, import.meta.url)));
const report = { capturedAt: new Date().toISOString(), vectorHash, supplementHash, sourceHashes, counts, categories, results };
if (process.argv[2] === "--freeze-supplement") {
  const target = fileURLToPath(new URL("./supplement-observation.json", import.meta.url));
  assert.throws(() => readFileSync(target), { code: "ENOENT" });
  const content = `${JSON.stringify(report, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${target}\n${content.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
  const applied = spawnSync("apply_patch", [patch], { shell: false, encoding: "utf8", timeout: 2000, maxBuffer: 65536 });
  assert.equal(applied.status, 0, applied.stderr);
  console.log(JSON.stringify({ counts, categories, observationSha256: digest(Buffer.from(content)) }, null, 2));
} else console.log(JSON.stringify(report, null, 2));

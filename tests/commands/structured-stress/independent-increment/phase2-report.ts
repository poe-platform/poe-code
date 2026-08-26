import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allVectors, digest, executeVector, expectedBytes, type BytesResult, type Vector } from "./harness.js";
import { additiveVectors, authorProbeMistakes } from "./phase2-harness.js";

type Classification = "exact" | "semantic" | "diagnostic-only";
type Row = { id: string; category: string; classification: Classification; differingFields: string[]; expected: BytesResult; actual: BytesResult };
const tally = (rows: Row[]) => {
  const result = { cases: rows.length, exact: 0, semantic: 0, "diagnostic-only": 0 };
  for (const row of rows) result[row.classification]++;
  return result;
};
async function observe(vectors: Vector[]) {
  const rows: Row[] = [];
  for (const vector of vectors) {
    const expected = expectedBytes(vector);
    const actual = await executeVector(vector);
    const differingFields = (Object.keys(expected) as (keyof BytesResult)[]).filter(key => expected[key] !== actual[key]);
    rows.push({ id: vector.id, category: vector.category, classification: differingFields.length === 0 ? "exact" : differingFields.every(key => key === "stderrHex") ? "diagnostic-only" : "semantic", differingFields, expected, actual });
  }
  return { counts: tally(rows), categories: Object.fromEntries([...new Set(rows.map(row => row.category))].map(category => [category, tally(rows.filter(row => row.category === category))])), rows };
}
const original = await observe(allVectors);
const additive = await observe(additiveVectors);
const baseline = ["phase1-observation.json", "supplement-observation.json"].flatMap(name => (JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8")) as { results: Row[] }).results);
const malformed = new Set(["fromjson", "join-mixed", "join-mixed:bytewise"]);
const group = (row: Row): string => {
  if (malformed.has(row.id)) return "malformed-original-probes";
  if (row.category === "pipeline") return "pipeline-propagation";
  if (row.classification === "diagnostic-only") return "diagnostic-formatting";
  if (row.category === "object-iteration") return row.id.includes(";") ? "quantifier-generator-overload" : "quantifier-object-iteration";
  if (row.category === "utf8" || row.category === "file-boundary") return "unicode-repair";
  if (row.category === "error-ordering") return "per-input-error-recovery";
  if (row.id.startsWith("number-overflow")) return "decimal-exponent-range";
  if (["decimal-equality", "decimal-order", "decimal-unique"].includes(row.id)) return "decimal-comparison";
  if (row.category === "numeric-length" || ["small-double", "large-double"].includes(row.id)) return "computed-double-formatting";
  return "decimal-preservation";
};
const baselineFailures = baseline.filter(row => row.classification !== "exact");
const bugCategories = Object.fromEntries([...new Set(baselineFailures.map(group))].map(category => {
  const before = baselineFailures.filter(row => group(row) === category);
  const after = original.rows.filter(row => before.some(previous => previous.id === row.id));
  return [category, { baselineDifferences: before.length, after: tally(after), ids: before.map(row => row.id) }];
}));
const sourceHashes: Record<string, string> = {};
for (const name of ["input.ts", "jq.ts", "interpreter.ts", "parser.ts", "limits.ts", "values.ts", "numbers.ts"]) sourceHashes[name] = digest(readFileSync(new URL(`../../../../src/commands/structured/${name}`, import.meta.url)));
const report = { capturedAt: new Date().toISOString(), oracle: "jq-1.7.1-apple", note: "Author product observations, not native expectations or independent final verification. Full original and additive denominators include malformed/probe-construction rows.", sourceHashes, baseline: tally(baseline), original, additive, bugCategories, diagnosedOriginalMalformed: [...malformed], diagnosedAuthorProbeMistakes: [...authorProbeMistakes] };
if (process.argv[2] === "--freeze" || process.argv[2] === "--freeze-final") {
  const target = fileURLToPath(new URL(process.argv[2] === "--freeze-final" ? "./phase2-final-observation.json" : "./phase2-observation.json", import.meta.url));
  assert.throws(() => readFileSync(target), { code: "ENOENT" });
  const content = `${JSON.stringify(report, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${target}\n${content.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
  const applied = spawnSync("apply_patch", [patch], { shell: false, encoding: "utf8", timeout: 2000, maxBuffer: 65536 });
  assert.equal(applied.status, 0, applied.stderr);
  console.log(JSON.stringify({ original: original.counts, additive: additive.counts, observationSha256: digest(Buffer.from(content)) }, null, 2));
} else console.log(JSON.stringify(report, null, 2));

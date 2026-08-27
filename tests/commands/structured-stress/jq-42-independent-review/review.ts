import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { addArtifact, bytesResult, directory, sourceSnapshot } from "./common.mjs";
import { loadEvidence, manifestSha256, transports } from "./evidence.mjs";
import { loadPublicHarness, type BytesResult, type Vector } from "./harness.js";

const { values } = parseArgs({ options: {
  "post-handoff": { type: "boolean" }, advisory: { type: "boolean" },
  "independent-only": { type: "boolean" }, "structured-sha256": { type: "string" }, report: { type: "string" },
} });
assert.notEqual(Boolean(values["post-handoff"]), Boolean(values.advisory), "choose --advisory or --post-handoff");
assert.match(values.report ?? "", /^[a-z0-9][a-z0-9-]*$/u, "--report requires a unique owned artifact name");
assert.equal(existsSync(join(directory, `${values.report}.json`)), false, "never overwrite a previous review report");
if (values["post-handoff"]) {
  assert.equal(Boolean(values["independent-only"]), false, "post-handoff cannot exclude whole cohorts");
  assert.match(values["structured-sha256"] ?? "", /^[a-f0-9]{64}$/u, "require author-handoff structured tree hash");
}
const evidence = loadEvidence();
const before = sourceSnapshot();
if (values["structured-sha256"]) assert.equal(before.structuredSha256, values["structured-sha256"], "source does not match handoff");
const execute = await loadPublicHarness();
assert.equal(sourceSnapshot().productSha256, before.productSha256, "source changed during public import");
const vectors: Vector[] = values["independent-only"] ? evidence.independent : evidence.vectors;
const results: {
  id: string; cohort: string; original42: boolean; route: string; transport: string; pass: boolean;
  expected: BytesResult; actual?: BytesResult; actualStages?: BytesResult[]; differingFields?: string[]; stageDifferences?: number[]; error?: string;
}[] = [];
for (const vector of vectors) {
  for (const route of ["direct", "shell"] as const) {
    for (const transport of transports(vector)) {
      const identity = { id: vector.id, cohort: vector.cohort, original42: evidence.original.has(`${vector.cohort}:${vector.id}`), route, transport, expected: bytesResult(vector.expected) };
      try {
        const { actual, stages } = await execute(vector, route, transport);
        const differingFields = (["status", "stdoutHex", "stderrHex"] as const).filter(field => actual[field] !== vector.expected[field]);
        const stageDifferences = stages?.flatMap((stage, index) => JSON.stringify(stage) === JSON.stringify(bytesResult(vector.stages![index]!.expected)) ? [] : [index]) ?? [];
        results.push({ ...identity, actual, ...(stages ? { actualStages: stages } : {}), differingFields, stageDifferences, pass: differingFields.length === 0 && stageDifferences.length === 0 });
      } catch (error) {
        results.push({ ...identity, pass: false, error: error instanceof Error ? error.stack ?? error.message : String(error) });
      }
    }
  }
}
const after = sourceSnapshot();
const stableSource = before.productSha256 === after.productSha256 && JSON.stringify(before.tooling) === JSON.stringify(after.tooling);
const summarize = (rows: typeof results) => {
  const identifiers = new Set(rows.map(row => `${row.cohort}:${row.id}`));
  const failed = new Set(rows.filter(row => !row.pass).map(row => `${row.cohort}:${row.id}`));
  return { uniqueVectors: identifiers.size, vectorsPassingAllRoutesAndTransports: identifiers.size - failed.size, vectorsFailingAny: failed.size,
    executions: rows.length, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length };
};
const summary = {
  original42: summarize(results.filter(row => row.original42)),
  independent155: summarize(results.filter(row => row.cohort === "independent")),
  additive81: summarize(results.filter(row => row.cohort === "additive")),
  reviewer20: summarize(results.filter(row => row.cohort === "reviewer")),
  routes: Object.fromEntries(["direct", "shell"].map(route => [route, summarize(results.filter(row => row.route === route))])),
};
const report = {
  phase: values.advisory ? "PREP ADVISORY ONLY: source may be moving; not final validation" : "post-handoff whole-cohort review",
  startedFromHandoffHash: values["structured-sha256"] ?? null,
  recordedAt: new Date().toISOString(), manifestSha256, stableSource,
  validity: stableSource ? "pre/post source and tooling hashes agree; no guarantee against transient ABA edits" : "INVALID source changed during execution; do not credit passes",
  before, after, summary, results,
  limits: "Exact status/stdout/stderr comparison; no diagnostic normalization, exclusions or capability skips. Direct pipelines chain actual output and assert every stage; shell pipelines use public byte sinks. Native stage-concatenated stderr does not assert cross-process timing. Passing is not full jq parity or product superiority.",
};
const sha256 = addArtifact(`${values.report}.json`, report);
console.log(JSON.stringify({ phase: report.phase, stableSource, summary, reportSha256: sha256 }, null, 2));
process.exitCode = !stableSource ? 2 : results.some(row => !row.pass) ? 1 : 0;

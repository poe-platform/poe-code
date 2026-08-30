import assert from "node:assert/strict";
import { join } from "node:path";
import { directory, repository, owner, read, json, digest } from "./common.mjs";
import { prior, priorCommit, tools, treeEntries, bindAcceptedProof } from "./auth.mjs";
import { aggregateControls } from "./verdict.mjs";
import { limits } from "./transport.mjs";

const history = [...json(join(prior, "PINS.json")).history];
for (const subtree of ["component-execution-v4", "component-execution-v4-blocker"]) {
  const prefix = `${owner}/${subtree}`; history.push({ commit: priorCommit, prefix, entries: treeEntries(priorCommit, prefix) });
}
const bindings = [];
for (const [commit, paths] of [
  ["f8b982f09e51b9a0a073b0b7bb393cb54796dd62", ["cases.json", "consumer.mjs", "positive.ts.fixture", "negative.ts.fixture", "README.md", "PROTOCOL.md", "self-check.mjs", "provenance.json", "FREEZE-CHECKS.json"].map(name => `${owner}/${name}`)],
  ["a0142c7711c4be2cc33384c87bd6d8dea9e3d07d", [`${owner}/component-admission-v1`]],
  ["8d07bd6e7549aaa9a1096c3e9278b231692bc699", ["tests/plugins/expr-public-author/evidence-v1/REVIEW-HANDOFF.json", "tests/plugins/expr-public-author/POLICY.md"]],
]) for (const path of paths) { const rows = treeEntries(commit, path); assert.ok(rows.length > 0, path); bindings.push(...rows); }
const proof = bindAcceptedProof();
const pins = { schema: "expr-v5-pins/1", authorizationDate: "2026-08-28", history, bindings, tools, acceptedP01: proof.P01, reader: proof.reader, repair: proof.repair,
  cases: { path: `${owner}/component-execution-v1/cases.json`, sha256: digest(read(join(repository, owner, "component-execution-v1/cases.json"))), bytes: 5911, unchanged: true },
  observerSha256: "1fffd7e99be072e87127be1af56461334a6db529d37c8be38b5418762548e37c", silentWorkerSha256: "fbd03925f44cda3e46a012e3060e4c2e5547773dc4c26ca40a0dcb53bc5ef9ed",
  limits, transportControls: ["compiler-positive", "compiler-late-error", "compiler-forbidden", "overflow", "nonzero", "line-overflow", "diagnostic-overflow", "ordinary-cap"], aggregateControls,
  counts: { newTransportControls: 16, newAggregateControls: aggregateControls.length, newControls: 16 + aggregateControls.length, runtime: 104, types: 40, packageControls: 36 },
  generatedTopLevel: ["work", "EXECUTION.raw.txt", "PRE-BINDINGS.json", "POST-BINDINGS.json", "TRACE-CONTROLS.json", "REPORT.json", "MANIFEST.json", "RAW.jsonl.gz", "FINALIZATION.json", "VERDICT.json", "OUTER.json", "EVIDENCE-SEAL.json", "REPORT.md"] };
const content = JSON.stringify(pins, null, 2) + "\n";
process.stdout.write(`*** Begin Patch\n*** Add File: ${owner}/component-execution-v5/PINS.json\n${content.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`);

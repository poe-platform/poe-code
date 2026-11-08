import assert from "node:assert/strict";
import { join } from "node:path";
import { directory, repository, owner, prefix, oldDirectory, legacyDirectory, read, json, digest, put, putJson } from "./common.mjs";
import { treeEntries, tools, inputs } from "../component-execution-v5/auth.mjs";

assert.equal(json(join(directory, "INSPECTION.json")).N04.verified, true);
for (const name of ["transport.mjs"]) put(join(directory, name), read(join(oldDirectory, name)));
for (const name of ["guard.mjs", "observer.mjs", "worker-guard.mjs", "silent-worker.mjs", "cases.json", "positive.ts.fixture", "negative.ts.fixture"]) put(join(directory, name), read(join(legacyDirectory, name)));
const negative = read(join(directory, "negative.ts.fixture")).toString();
put(join(directory, "N04.ts.fixture"), negative.replace(/\/\/ @ts-expect-error N04[^\n]*/u, ""));
put(join(directory, "combined.ts.fixture"), negative.replace(/\/\/ @ts-expect-error[^\n]*/gu, ""));
for (const row of json(join(directory, "INSPECTION.json")).N04.rows) assert.equal(digest(read(join(directory, `${row.id}.ts.fixture`))), row.inputSha256);
const predecessor = json(join(oldDirectory, "PINS.json"));
const history = [...predecessor.history];
for (const folder of ["component-execution-v5", "component-execution-v5-result"]) {
  const path = `${owner}/${folder}`, commit = "7b68a7b2866217a21d52ff8b99dcab166f83f5ae";
  history.push({ commit, prefix: path, entries: treeEntries(commit, path) });
}
const counts = { targetedTypeOutcomes: 8, R21ObservationsNotRescored: 16, boundaryControls: 16, sourceFallbackControls: 4, freshTraceBindingControls: 4, validatorControls: 42, resolutionParserControls: 6, newControls: 72, probeChildren: 48, expectedForcedChildren: 0 };
putJson(join(directory, "PINS.json"), { schema: "expr-r21-n04-pins/1", authorizationDate: "2026-08-28", prefix, history, bindings: predecessor.bindings, tools, runtimes: inputs.runtimes, counts,
  reusedControls: { reader: 16, repair: 28, trace: 38, replayed: 0 },
  fixedLimits: { ordinary: 1048576, trace: 67108864, line: 131072, diagnostics: 256, diagnosticBytes: 262144, reapMs: 5000, childMs: 15000, outerMs: 300000 },
  generated: ["work", "EXECUTION.raw.txt", "PRE-BINDINGS.json", "POST-BINDINGS.json", "REPORT.json", "FINALIZATION.json", "OUTER.json", "MANIFEST.json", "RAW.jsonl.gz", "EVIDENCE-SEAL.json", "REPORT.md", "AUDIT.json"] });
console.log(JSON.stringify({ checkpoint: "prepared-no-product-execution", counts, pinnedHistoryGroups: history.length }));

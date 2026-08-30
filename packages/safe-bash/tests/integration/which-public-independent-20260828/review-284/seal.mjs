import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const compressed = Buffer.from(fs.readFileSync(path.join(own, "actual-01.json.gz.base64"), "utf8"), "base64");
const capture = JSON.parse(gunzipSync(compressed));
assert.equal(capture.completed, true);
assert.equal(capture.temporaryRemoved, true);
assert.equal(fs.existsSync(capture.temporary), false);
const counts = stdout => Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
const sweep = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
assert.equal(sweep.status, 0);
const matches = sweep.stdout.split("\n").filter(line => line.includes(capture.temporary));
assert.deepEqual(matches, []);
const report = {
  sealedAt: new Date().toISOString(), verdict: "Recommend scoped public WHICH component acceptance, not whole76/77 gate or combined Stage2 runtime acceptance",
  candidate: capture.candidate, rootSource: capture.rootSource, baseline76: capture.baseline76,
  independentFreeze: capture.freeze, fixtureHashes: capture.fixtureHashes,
  sourceArchiveSha256: capture.archiveSha256, sourceInputCount: Object.keys(capture.sourceHashes).length,
  sourceHashes: Object.fromEntries(["src/index.ts", "src/plugins/index.ts", "package.json", "src/commands/which/index.ts", "src/commands/which/options.ts", "src/commands/which/which.ts", "src/shell/runtime.ts", "src/shell/shell.ts"].map(name => [name, capture.sourceHashes[name]])),
  package: { sha256: capture.package.sha256, entries: capture.package.metadata.entryCount, emittedFiles: Object.keys(capture.emittedInventory).length },
  node: capture.node, tools: Object.fromEntries(Object.entries(capture.tools).map(([name, tool]) => [name, tool.version])),
  layouts: Object.fromEntries(Object.entries(capture.layouts).map(([name, layout]) => [name, {
    runtime: counts(capture.records.find(row => row.label === `${name}-runtime18`).stdout),
    types: capture.records.filter(row => row.label.startsWith(`${name}-T`)).map(row => ({ label: row.label, exitCode: row.status })),
    authenticatedProductModules: layout.loadedProduct.length,
  }])),
  negativeControls: {
    frozenClasses: 8, runtimeAssertionMutations: ["N01", "N03", "N04", "N05", "N06"],
    intentionalExportImportFailure: { id: "N02", code: "ERR_PACKAGE_PATH_NOT_EXPORTED", semanticCasesExecuted: 0 },
    typeMutation: { id: "N07", codes: ["TS2344", "TS2322", "TS2578", "TS2578"] },
    loaderClassN08: ["changed package bytes", "unlisted module", "live checkout emitted module"],
    failedBeforeMutationOrSetup: 0, survivingMutants: 0,
  },
  prerequisite: "Parent2ffcb23d whole76 gate remains separately unresolved per root handoff; this review does not run, waive or establish an accepted76 gate prerequisite. Exact77 membership is component behavior, not release-gate substitution.",
  priorHistory: "Module original25/26 both layouts, approved two-token B18 overlay1/1 both, public pre-code02ccea66 freeze, Stage2 baselines13/26 and14/26 unchanged",
  omitted: ["module26 replay", "native which execution", "Node24 independent replay", "whole76/77 gate", "Stage2+WHICH combined candidate", "SafeJS/private-engine/services"],
  sourceBugs: [],
  cleanup: { allDirectChildrenExitedNaturallyAndESRCH: capture.records.every(row => row.status !== null && row.signal === null && row.directChildGone), temporaryRemoved: true, remainingOwnedRootProcesses: matches },
  evidence: { filename: "actual-01.json.gz.base64", compressedSha256: hash(compressed) },
  files: Object.fromEntries(fs.readdirSync(own).filter(name => name !== "REVIEW.json").sort().map(name => [name, hash(fs.readFileSync(path.join(own, name)))])),
};
fs.writeFileSync(path.join(own, "REVIEW.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ sha256: hash(fs.readFileSync(path.join(own, "REVIEW.json"))), verdict: report.verdict, layouts: report.layouts, cleanup: report.cleanup }, null, 2));

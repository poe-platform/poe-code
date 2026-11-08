import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const names = ["focused-01", "focused-02", "controls-01", "controls-supplement-02", "regressions-01", "regressions-02"];
const data = Object.fromEntries(names.map(name => {
  const bytes = Buffer.from(fs.readFileSync(path.join(own, `${name}.json.gz.base64`), "utf8"), "base64");
  return [name, { compressedSha256: hash(bytes), capture: JSON.parse(gunzipSync(bytes)) }];
}));
const focused = data["focused-02"].capture;
const counts = stdout => Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
const summary = {
  sealedAt: new Date().toISOString(), verdict: "Recommend scoped Stage2 acceptance; no product defect demonstrated; not whole-gate or SafeJS acceptance",
  baseline: focused.baseline, candidate: focused.candidate, helper: focused.helper,
  executedProduct: "fixed baseline plus exact accepted helper and five candidate blobs, not whole fd1 HEAD",
  sourceArchiveSha256: focused.archiveSha256,
  sourceFiles: Object.keys(focused.sourceInventory).length,
  sourceHashes: Object.fromEntries([...focused.fivePaths, "src/shell/cancellation.ts"].map(name => [name, focused.sourceInventory[name].sha256])),
  fixtures: { freeze: "98f400c4a33eeb03f825213054f90adc1fd979c4", amendment: "7fb923dc4b3275f34ff37936a48220245c220163", effectiveSha256: focused.cohortSha256 },
  package: { sha256: focused.package.sha256, files: focused.package.metadata.entryCount, emittedFiles: Object.keys(focused.emittedInventory).length },
  node: focused.node, tools: Object.fromEntries(Object.entries(focused.tools).map(([name, tool]) => [name, tool.version])),
  layouts: Object.fromEntries(Object.entries(focused.layouts).map(([name, layout]) => [name, {
    runtime: counts(focused.records.find(row => row.label === `${name}-runtime26`).stdout),
    frozenTypeFamilies: 6, decisionTypeControls: 2, allTypeCompilationsExitZero: focused.records.filter(row => row.label.startsWith(`${name}-T`)).every(row => row.status === 0),
    loadedProductModules: layout.loadedProduct.length,
    moduleUrl: layout.moduleUrl,
    publicBareResolution: name === "source" ? null : JSON.parse(focused.records.find(row => row.label === `${name}-public-resolution`).stdout).resolved,
  }])),
  controls: {
    originalRuntimeMutantsRejected: ["M01", "M02", "M03", "M04", "M06", "M07", "M08", "M09"],
    originalRuntimeSurvivor: { id: "M05", selectedCases: ["R13", "R14"], pass: 2, fail: 0 },
    typeMutantRejected: { id: "M10", diagnostic: "TS2578 only" },
    loaderControlsRejected: ["G01-changed", "G02-unlisted", "G03-live"],
    supplemental: {
      unmodifiedCandidate: { pass: 2, fail: 0 },
      sameM05Mutant: { pass: 1, fail: 1, rejectedBy: "S01 private runtime-selection seam", survived: "S02 actual nested invocation" },
      timing: "Both supplemental cases are post-candidate; S02 added after first control execution. Neither replaces the frozen cohort.",
    },
    qualification: "Ten classes exercised, not ten original runtime assertion kills. M04/M08 fail on actual admission/budget errors; M05 is rejected only by supplemental private seam.",
  },
  regressions: Object.fromEntries(data["regressions-02"].capture.records.filter(row => row.label !== "build").map(row => [row.label, counts(row.stdout)])),
  initialRegressionFailure: { pass: 279, fail: 1, cause: "Reviewer omitted getopts provenance support; existing test ENOENT for evidence/phase1-before.json",
    addedBaselineFiles: Object.keys(data["regressions-02"].capture.testInputs).filter(name => !Object.hasOwn(data["regressions-01"].capture.testInputs, name)),
    assertionChanges: 0, productChanges: 0 },
  regressionMovedClaimQualification: "Existing env-shebang moved consumer inside source tree resolves source/dist through package self-reference; its maintained pass is not moved-install proof. Focused installed/moved runs independently resolve the installed public export outside source.",
  originalHistory: { baselineV1: "13/26", baselineV2: "14/26", R08v3: "only outer mapped exitCode 1 amendment; all seven inner reasons and remaining assertions unchanged" },
  omitted: ["Actual SafeJS 25-profile replay/private snapshots", "Whole repository gate", "WHICH77 review", "Timeout command or status124 mapping", "Cross-platform/deployed-provider/native parity claims"],
  sourceBugs: [],
  evidence: Object.fromEntries(Object.entries(data).map(([name, entry]) => [name, { compressedSha256: entry.compressedSha256, completed: entry.capture.completed, temporaryRemoved: entry.capture.temporaryRemoved }])),
};
const processSnapshot = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
assert.equal(processSnapshot.status, 0);
summary.processCheck = {
  command: "ps -axo pid=,ppid=,command=, filtered to exact owned scratch roots",
  ownedRoots: names.map(name => data[name].capture.temporary),
  matches: processSnapshot.stdout.split("\n").filter(line => names.some(name => line.includes(data[name].capture.temporary))),
  qualification: "Bounded direct children exited without signal/watchdog; maintained subprocess tests assert direct child ESRCH. This is not a global host-process census or heap-retention proof.",
};
assert.deepEqual(summary.processCheck.matches, []);
for (const entry of Object.values(data)) {
  assert.equal(entry.capture.completed, true);
  assert.equal(entry.capture.temporaryRemoved, true);
  assert.equal(fs.existsSync(entry.capture.temporary), false);
}
summary.files = Object.fromEntries(fs.readdirSync(own).filter(name => name !== "REVIEW.json").sort().map(name => [name, hash(fs.readFileSync(path.join(own, name)))]));
fs.writeFileSync(path.join(own, "REVIEW.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ verdict: summary.verdict, sha256: hash(fs.readFileSync(path.join(own, "REVIEW.json"))), layouts: summary.layouts, regressions: summary.regressions }, null, 2));

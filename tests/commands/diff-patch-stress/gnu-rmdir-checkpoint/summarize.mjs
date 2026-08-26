import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

assert.equal(process.cwd(), "/Users/kjopek/Workspace/safe-bash");
const evidence = process.argv[2];
assert(evidence, "usage: node summarize.mjs EVIDENCE_DIRECTORY");
const read = path => JSON.parse(readFileSync(join(evidence, path), "utf8"));
const digest = value => createHash("sha256").update(value).digest("hex");
const result = read("result.json");
const identity = read("identity.json");
const inputs = read("inputs.json");
assert.equal(result.inputAggregate, identity.inputAggregate);
const artifacts = Object.fromEntries(readdirSync(evidence).sort().filter(name => lstatSync(join(evidence, name)).isFile()).map(name => [name, { path: join(evidence, name), sha256: digest(readFileSync(join(evidence, name))), bytes: lstatSync(join(evidence, name)).size }]));
const counts = cohort => Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo", "exitCode"].filter(key => key in cohort).map(key => [key, cohort[key]]));
const processes = spawnSync("ps", ["-axo", "pid,ppid,args"], { encoding: "utf8", cwd: process.cwd() });
assert.equal(processes.status, 0, processes.stderr);
const active = processes.stdout.split("\n").filter(line => line.includes(result.snapshot) && !line.includes("summarize.mjs"));
const safetyRun = result.runs.find(run => run.name === "independent-safety");
const supplements = readdirSync(evidence).filter(name => name.startsWith("supplement-")).map(name => read(`${name}/summary.json`)).sort((left, right) => left.startedAt.localeCompare(right.startedAt));
const safetySupplement = supplements.findLast(record => record.tool.endsWith("/safety-probe.mjs") && record.exitCode === 0);
const diagnosisSupplement = supplements.findLast(record => record.tool.endsWith("/diagnose-emptyfile.mjs") && record.exitCode === 0);
const safety = safetySupplement ? JSON.parse(readFileSync(join(safetySupplement.supplement, "stdout"), "utf8")) : safetyRun.exitCode === 0 ? JSON.parse(readFileSync(safetyRun.stdout.path, "utf8")) : null;
const diagnosis = diagnosisSupplement ? JSON.parse(readFileSync(join(diagnosisSupplement.supplement, "stdout"), "utf8")) : null;
const supplementalArtifacts = Object.fromEntries(supplements.map(record => [record.supplement, Object.fromEntries(readdirSync(record.supplement).filter(name => lstatSync(join(record.supplement, name)).isFile()).map(name => [name, { sha256: digest(readFileSync(join(record.supplement, name))), bytes: lstatSync(join(record.supplement, name)).size }]))]));
const diagnosedNames = new Set(diagnosis?.observations.map(observation => observation.name) ?? []);
const failures = result.failures.map(failure => ({ ...failure, historicalClassification: failure.historicalClassification ?? failure.classification, classification: diagnosedNames.has(failure.name) ? "unwaived-newly-exposed-nlink-and-rm-instrumentation-assertions" : failure.classification }));
const driverPaths = ["/tmp/safe-bash-diff-rmdir-verifier-run.stdout", "/tmp/safe-bash-diff-rmdir-verifier-run.stderr", "/tmp/safe-bash-diff-rmdir-verifier-run.exit"];
const driver = { rawExitCode: Number(readFileSync(driverPaths[2], "utf8")), artifacts: Object.fromEntries(driverPaths.map(path => [path, { sha256: digest(readFileSync(path)), bytes: lstatSync(path).size }])) };
assert.equal(driver.rawExitCode, result.acceptable ? 0 : 1);
const publicRun = result.runs.find(run => run.name === "public-probe");
const publicPackage = publicRun.exitCode === 0 ? JSON.parse(readFileSync(publicRun.stdout.path, "utf8")) : null;
const checkpoint = {
  schemaVersion: 1,
  decision: result.acceptable ? "accepted" : "not-accepted",
  driver,
  evidenceDirectory: evidence,
  snapshot: result.snapshot,
  startedAt: result.startedAt,
  finishedAt: result.finishedAt,
  head: result.head,
  sourceCommit: result.sourceCommit,
  readiness: { path: identity.marker, contents: identity.markerContents, sha256: identity.markerSha256 },
  inputs: { roots: identity.roots, exclusions: identity.exclusions, count: identity.inputCount, aggregateSha256: result.inputAggregate, sourceAggregateSha256: result.sourceAggregate, immutable: result.immutable, undeclaredOutputs: result.undeclaredOutputs, attempts: result.attempts },
  dependencies: { count: identity.dependencyCount, aggregateSha256: result.dependencyAggregate, packages: identity.packages, copiedNotLinked: true },
  runtime: { ...identity.node, binaries: identity.binaries },
  originalIdentity: result.originalAfter,
  sourceFiles: Object.fromEntries(Object.entries(inputs).filter(([path]) => path.startsWith("src/commands/diff-patch/") || path === "src/contracts/filesystem.ts" || /^src\/fs\/[^/]+\/index.ts$/u.test(path))),
  original3758: { ...result.totals, files: 70, rawExitCode: result.suites.every(suite => suite.exitCode === 0) ? 0 : 1, suites: result.suites.map(({ failures, ...suite }) => suite) },
  revised96: { ...counts(result.revised), files: result.revised.files },
  consumerNew: { ...counts(result.consumer), files: result.consumer.files },
  independentSafety: { initialExitCode: safetyRun.exitCode, supplementalExitCode: safetySupplement?.exitCode ?? null, checks: safety?.checks ?? null, cases: safety?.observations.map(({ kind, atomic }) => ({ kind, atomic })) ?? [], initialToolingFailuresRetained: ["async wrapper incorrectly changed readStream return type", "unsupported -o used instead of supported selected reject output"], supplements: supplements.filter(record => record.tool.endsWith("/safety-probe.mjs")) },
  independentDiagnosis: diagnosis ? { cases: diagnosis.cases, supplement: diagnosisSupplement, observations: diagnosis.observations.map(observation => ({ name: observation.name, productExitCode: observation.product.result.exitCode, nativeExitCode: observation.native.exitCode, productRootNlink: [observation.product.before["/"].nlink, observation.product.after["/"].nlink], nativeRootNlink: [observation.native.before["/"].nlink, observation.native.after["/"].nlink], actualRemovalCalls: observation.product.actualRemovalCalls, originalObservedMutations: observation.product.originalObservedMutations, originalExpectedMutations: observation.product.originalExpectedMutations, diagnosis: observation.diagnosis })) } : null,
  original30: result.original30,
  failures,
  unexpected: failures.filter(failure => !failure.classification.startsWith("expectation-conflict")),
  cohortIntegrity: result.cohortIntegrity,
  oracle: { stable: result.oracleStable, identities: read("oracle-before.stdout") },
  globalChecks: result.runs.filter(run => ["typecheck", "build", "fixture-probe", "public-probe", "independent-safety"].includes(run.name)),
  publicPackage,
  boundaries: result.boundaries,
  activeSnapshotProcesses: active,
  artifacts,
  supplementalArtifacts,
  limitations: [
    "Original3758 retains its two unchanged expectations; revised96 and consumer-new never replace them or enlarge the denominator.",
    "Original30 historical literal replay remains14 pass/16 fail; not rerun here.",
    "GNU ignores native pruning errors; explicit unsupported, permission and transport failures are intentional divergence.",
    "Independent deterministic races exercise Memory backend, not global remote atomicity or symlink-race immunity.",
    "Backend readiness comes from ROOT marker and recorded commits, not a fresh complete adapter matrix.",
    "No whole-shell, whole-product or just-bash-superiority claim.",
  ],
};
const path = "tests/commands/diff-patch-stress/gnu-rmdir-checkpoint/CHECKPOINT.json";
const patch = `*** Begin Patch\n*** Add File: ${path}\n${JSON.stringify(checkpoint, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
const applied = spawnSync("apply_patch", [], { input: patch, encoding: "utf8", cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024 });
assert.equal(applied.status, 0, applied.stderr);
console.log(applied.stdout);
console.log(JSON.stringify({ decision: checkpoint.decision, original: result.totals, revised: counts(result.revised), consumer: counts(result.consumer), independentSafety: checkpoint.independentSafety, unexpected: result.unexpected.length, activeSnapshotProcesses: active }, null, 2));

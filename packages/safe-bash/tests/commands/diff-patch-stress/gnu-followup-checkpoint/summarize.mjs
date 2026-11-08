import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const evidence = realpathSync(process.argv[2]);
const read = name => JSON.parse(readFileSync(join(evidence, name), "utf8"));
const sha = value => createHash("sha256").update(value).digest("hex");
const result = read("result.json");
const identity = read("identity.json");
const inputs = read("inputs.json");
const outputs = read("snapshot-outputs.json");
const snapshot = realpathSync(result.snapshot);
const events = result.suites.flatMap(suite => readFileSync(join(evidence, `${suite.suite}.events.jsonl`), "utf8").trim().split("\n").map(line => ({ suite: suite.suite, ...JSON.parse(line) })));
const passed = (suite, name) => {
  const matches = events.filter(event => event.suite === suite && event.data.name === name && ["test:pass", "test:fail"].includes(event.type));
  assert.equal(matches.length, 1, `${suite}: ${name}`);
  assert.equal(matches[0].type, "test:pass", name);
  return { suite, name, outcome: "pass" };
};
const quotedName = "quoted-path security: quoted ancestor symlink";
const backwardsName = "atomic extension malformed backward-second-hunk is not swallowed after a valid file section";
const absoluteName = "authorized absolute target preserves dev-null creation and reverse deletion";
const failures = result.suites.flatMap(suite => suite.failures.map(failure => {
  const error = failure.details.error.cause ?? failure.details.error;
  const classification = failure.name === quotedName ? "expectation-conflict-default-stripping" : failure.name === backwardsName ? "expectation-conflict-atomic-status" : /EISDIR/u.test(error.message) || failure.name === absoluteName ? "external-empty-directory-removal-contract" : "UNCLASSIFIED";
  assert.notEqual(classification, "UNCLASSIFIED", failure.name);
  return { suite: suite.suite, name: failure.name, file: relative(snapshot, failure.file), ordinal: failure.testNumber, classification,
    diagnostic: error.message.split("\n").filter(Boolean).slice(0, 3).join("\n"), rawEvidence: `${suite.suite}.events.jsonl` };
}));
assert.equal(failures.length, 36);
assert.equal(failures.filter(failure => failure.classification === "external-empty-directory-removal-contract").length, 34);
const historical = JSON.parse(readFileSync(join(snapshot, "tests/commands/diff-patch-stress/gnu-target-classification/evidence.json"), "utf8"));
const original30 = historical.failures.map(failure => {
  const category = failure.category;
  let disposition;
  let checks;
  if (category.endsWith("defect")) {
    const suite = category === "gnu-patch-defect" ? "fuzz" : failure.artifact.startsWith("formats") ? "formats" : "compatibility";
    disposition = "GNU product regression passes";
    checks = [passed(suite, failure.name)];
  } else if (category === "gnu-native-native-control") {
    disposition = "exact GNU negative calibration plus independent product correctness";
    checks = [passed("formats", failure.name.replace("native-native control", "GNU C0 calibration only")), passed("formats", failure.name.replace("native-native control", "independent formatter"))];
  } else if (category === "apple-reverse-control") {
    disposition = "exact Apple corruption calibration; independent product correctness passes";
    const fixture = failure.name.match(/context\/(.+)\/C0$/u)[1];
    checks = [passed("gnu-target", `Apple alternate calibration only: exact reverse corruption ${fixture}`), passed("formats", failure.name)];
  } else {
    assert.equal(category, "parser-native-control");
    disposition = "exact GNU negative/timeout calibration plus independent product parser result";
    checks = [passed("gnu-target", `GNU parser calibration only: ${failure.name}`), passed("parser-regressions", failure.name)];
  }
  return { historicalName: failure.name, historicalOrdinal: failure.ordinal, category, disposition, checks };
});
assert.equal(original30.length, 30);
const changedAfterDiagnostics = [];
for (const [path, entry] of Object.entries({ ...inputs, ...outputs })) {
  const absolute = join(snapshot, path);
  const stat = lstatSync(absolute);
  if (entry.link ? readlinkSync(absolute) !== entry.link : sha(readFileSync(absolute)) !== entry.sha256 || stat.size !== entry.size || (stat.mode & 0o777) !== entry.mode) changedAfterDiagnostics.push(path);
}
assert.deepEqual(changedAfterDiagnostics, []);
const processAudit = spawnSync("/usr/sbin/lsof", ["-n", "-P", "-a", "-d", "cwd", "+D", snapshot], { encoding: "utf8", timeout: 30000 });
assert.equal(processAudit.status, 1, processAudit.stdout + processAudit.stderr);
assert.equal(processAudit.stdout, "");
assert.equal(processAudit.stderr, "");
const gitPath = spawnSync("/usr/bin/xcrun", ["--find", "git"], { encoding: "utf8" });
assert.equal(gitPath.status, 0);
const gitVersion = spawnSync("/usr/bin/git", ["--version"], { encoding: "utf8" });
assert.equal(gitVersion.status, 0);
const supplemental = { at: new Date().toISOString(), changedAfterDiagnostics, checkedInputs: Object.keys(inputs).length, checkedBuildOutputs: Object.keys(outputs).length,
  activeSnapshotProcesses: 0, processAudit: { command: ["/usr/sbin/lsof", "-n", "-P", "-a", "-d", "cwd", "+D", snapshot], exitCode: processAudit.status, stdout: processAudit.stdout, stderr: processAudit.stderr },
  gitReferenceIdentity: { timing: "supplemental after-capture identity, not a before/after pin", version: gitVersion.stdout.trim(), binaries: ["/usr/bin/git", gitPath.stdout.trim()].map(path => ({ path, sha256: sha(readFileSync(path)), mtime: lstatSync(path).mtime.toISOString() })) } };
writeFileSync(join(evidence, "supplemental-verification.json"), `${JSON.stringify(supplemental, null, 2)}\n`, { flag: "wx" });
const artifacts = Object.fromEntries(readdirSync(evidence).sort().filter(name => lstatSync(join(evidence, name)).isFile()).map(name => { const bytes = readFileSync(join(evidence, name)); return [name, { bytes: bytes.length, sha256: sha(bytes) }]; }));
const diagnostic = read("failure-probe.stdout");
const probes = diagnostic.observations.map(row => ({ name: row.name, args: row.args, input: row.input, files: row.files, links: row.links,
  product: { exitCode: row.product.exitCode, stdout: row.product.stdout, stderr: row.product.stderr, mutations: row.product.mutations },
  native: { exitCode: row.native.exitCode, stdout: row.native.stdout, stderr: row.native.stderr }, fullNamespaces: "failure-probe.stdout" }));
const summary = { schemaVersion: 1, decision: "NOT ACCEPTED: all 36 raw failures remain in the denominator", evidenceDirectory: evidence, snapshot,
  startedAt: result.startedAt, finishedAt: result.finishedAt, head: result.head, readiness: { path: identity.marker, sha256: identity.markerSha256, contents: identity.markerContents },
  sourceCommits: ["d05c582", "05dee32", "3c4a1b0", "7f7fe63", "cccf34c", "bb74849", "15159dd", "7822b5f", "efa56b3", "87085fd", "56e2c63", "695eb07"],
  testAndHandoffCommits: ["e6f2e64", "6982d43", "2206a92", "6c9e5e0"],
  inputs: { roots: identity.roots, exclusions: identity.exclusions, count: identity.inputCount, aggregate: identity.inputAggregate, manifest: "inputs.json", copyAttempts: identity.attempts,
    workingState: "identity.json.workingState", uncommittedInputPaths: Object.keys(inputs).filter(path => identity.workingState.status.split("\n").some(line => line.slice(3) === path)),
    sourceHashes: Object.fromEntries(Object.entries(inputs).filter(([path]) => path.startsWith("src/commands/diff-patch/") && path.endsWith(".ts")).map(([path, entry]) => [path, entry.sha256])),
    compiledSiblingsBefore: identity.compiledSiblings, compiledSiblingsAfter: result.compiledSiblingsAfter, immutable: result.immutable, undeclaredOutputs: result.undeclaredOutputs, changedAfterDiagnostics },
  runtime: { node: identity.node, packages: identity.packages, dependencyRoot: identity.dependencyRoot, dependencyCount: identity.dependencyCount, dependencyAggregate: identity.dependencyAggregate, dependenciesStable: result.dependenciesStable },
  oracle: { beforeAfterStable: result.oracleStable, identities: read("oracle-before.stdout"), supplementalGit: supplemental.gitReferenceIdentity },
  totals: result.totals, testFiles: result.suites.reduce((total, suite) => total + suite.files.length, 0), suites: result.suites.map(({ suite, files, tests, pass, fail, skipped, cancelled, todo, exitCode, signal }) => ({ suite, files, tests, pass, fail, skipped, cancelled, todo, exitCode, signal })),
  failures, classificationCounts: { externalEmptyDirectoryPrimitive: 34, quotedDefaultStripExpectation: 1, atomicConflictStatusExpectation: 1 }, original30,
  globalChecks: result.runs.filter(run => ["typecheck", "build", "fixture-probe", "public-probe"].includes(run.name)), liveTypecheck: read("live-typecheck.json"),
  publicPackage: read("public-probe.stdout"), pruningBoundary: read("pruning-probe.stdout").primitive, diagnosticProbe: read("failure-probe-run.json"), diagnosticCases: probes,
  activeSnapshotProcesses: supplemental.activeSnapshotProcesses, artifacts,
  limits: ["Not a full-repository runtime test or universal GNU/Bash compatibility claim", "Historical native failures remain explicit calibrations, not native successes", "No comparator rerun, remote filesystem acceptance, superiority or 72-hour completion claim", "Supplemental diagnostic script is separately hash-frozen outside the snapshot; original inputs and built outputs rechecked unchanged"] };
const destination = "tests/commands/diff-patch-stress/gnu-followup-checkpoint/CHECKPOINT.json";
const content = `${JSON.stringify(summary, null, 2)}\n`;
process.stdout.write(`*** Begin Patch\n*** Add File: ${destination}\n${content.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`);

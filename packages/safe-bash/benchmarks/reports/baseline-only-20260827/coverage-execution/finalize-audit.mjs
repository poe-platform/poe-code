import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { owned, setup, json, hash, evidence, publish } from "./audit-common.mjs";
import { assess, stable, effects } from "./assess.mjs";

const destination = `${owned}/attempt-002`;
const inputs = json(`${destination}/execution-inputs.json`);
const results = json(`${destination}/results.json`);
const manifest = json(`${destination}/manifest.json`);
const frozen = json(`${destination}/freeze.json`);
const inventory = json(`${setup}/inventory.json`);
const matrix = json(`${destination}/matrix.json`);
assert.equal(hash(readFileSync(`${destination}/manifest.json`)), frozen.manifestSha256);
assert.equal(hash(readFileSync(`${destination}/execution-inputs.json`)), frozen.inputsSha256);
assert.equal(inputs.sourceSha256, "30f5cfb47f69af0aeb4460fa901904d0b70f4ca8594013f70aa308dafb379732");
assert.equal(inputs.cases.length, 61);
assert.equal(inputs.diagnostics.length, 7);
assert.deepEqual(matrix.rows.map(row => row.originalInventoryRow), inventory.rows);
assert.deepEqual(matrix.additionalOptional.map(row => row.originalInventoryRow), inventory.addedOptional);
const artifacts = [];
const captures = [];
const exceptions = [];
for (const specimen of [...inputs.cases, ...inputs.diagnostics]) {
  const { inputSha256, ...effective } = specimen;
  assert.equal(hash(JSON.stringify(effective)), inputSha256);
  for (const engine of ["ours", "baseline"]) {
    const filename = `${destination}/raw/${specimen.id}.${engine}.json`;
    const capture = json(filename);
    assert.equal(capture.engine, engine);
    assert.equal(capture.caseId, specimen.id);
    assert.ok(capture.phases.some(phase => phase.phase === "product-exec"));
    assert.ok(capture.report?.result);
    assert.deepEqual(capture.report.captureErrors, []);
    assert.equal(capture.report.before.complete, true);
    assert.equal(capture.report.after.complete, true);
    assert.deepEqual(assess(specimen, capture), capture.assessment);
    const normal = capture.exitCode === 0 && capture.signal === null && !capture.parentTimeout;
    if (!normal) exceptions.push({ engine, id: specimen.id, exitCode: capture.exitCode, signal: capture.signal, reason: capture.terminationReason, productResult: capture.report.result, productElapsedMs: capture.report.productElapsedMs, totalElapsedMs: capture.totalElapsedMs, lifecycleAccepted: false });
    if (engine === "ours") assert.deepEqual(capture.report.registeredNamesAfter.filter(name => name !== "curl"), inventory.current.virtual.registered);
    captures.push(capture);
    artifacts.push(evidence(filename));
  }
}
assert.equal(captures.length, 136);
assert.equal(exceptions.length, 1);
assert.equal(exceptions[0].id, "js-exec-positive");
assert.equal(exceptions[0].engine, "baseline");
assert.equal(exceptions[0].signal, "SIGTERM");
assert.equal(exceptions[0].productResult.exitCode, 0);
assert.equal(exceptions[0].productResult.stdoutBase64, Buffer.from("42\n").toString("base64"));
assert.equal(exceptions[0].productResult.stderrBase64, "");
for (const key of ["snapshotUnchanged", "dependenciesUnchanged", "harnessUnchanged", "runtimeExecutableUnchanged", "snapshotConfigurationUnchanged", "allObservedLoadedFilesMatchedFreeze"]) assert.equal(results.integrity[key], true, key);
for (const configuration of manifest.snapshotConfiguration) assert.equal(evidence(configuration.path).sha256, configuration.sha256);
assert.equal(inputs.childEnvironment.TSX_TSCONFIG_PATH, `${inputs.paths.snapshot}/tsconfig.json`);
assert.equal(hash(readFileSync(`${owned}/prepared-inputs.json`)), "2520e7c15cee5e760c9cb883aeb89ac9793176b21203b206e27420c8b7571915");
assert.equal(hash(readFileSync(`${owned}/prepared-matrix.json`)), "861db0797f752f6d8865a1dae6a6c38abcfa821d5a6d5469c4a371655e4f2fd7");
const strict = spawnSync(process.execPath, [`${owned}/verify-execution.mjs`, destination], { encoding: "utf8" });
assert.equal(strict.status, 1, "Strict all-normal gate remains failed; do not force green");
publish(`${destination}/strict-validation-failure.json`, { command: `${process.execPath} ${owned}/verify-execution.mjs ${destination}`, status: strict.status, signal: strict.signal, stdout: strict.stdout, stderr: strict.stderr, expectedReason: "Strict validator requires every child normal. js-exec instead required SIGTERM after successful result; preserved failure, not waived pass." });

const targets = results.observations.filter(row => ["historical-unmeasured", "additional-optional"].includes(row.cohort));
const meaningfulRows = targets.map(row => {
  const original = [...inventory.rows, ...inventory.addedOptional].find(candidate => candidate.name === row.name);
  const specimens = [...inputs.cases, ...inputs.diagnostics].filter(specimen => specimen.name === row.name);
  const ours = specimens.map(specimen => captures.find(capture => capture.caseId === specimen.id && capture.engine === "ours"));
  const missing = ours.find(capture => capture.report.result.exitCode === 127 && capture.report.result.stderr.includes(`${row.name}: command not found`));
  assert.ok(missing, `No actual missing-handler observation for ${row.name}`);
  const primary = ours.find(capture => capture.caseId === row.id);
  let oursPrimaryAttribution = row.ours.classification;
  if (primary.report.result.exitCode === 2 && /Unsupported operator &|unsupported parameter expansion/i.test(primary.report.result.stderr)) oursPrimaryAttribution = "syntax-blocked-before-target";
  const baselineCapture = captures.find(capture => capture.caseId === row.id && capture.engine === "baseline");
  const baselineClassification = row.name === "js-exec" ? "cleanup-timeout-after-successful-guest-execution" : row.baseline.classification;
  return {
    originalInventoryRow: original, name: row.name, cohort: row.cohort,
    primaryRecipeId: row.id, diagnostics: specimens.filter(specimen => specimen.cohort === "direct-diagnostic").map(specimen => specimen.id),
    ours: { operationalClassification: "missing-name-compatible-handler", primaryAttribution: oursPrimaryAttribution, frozenRawPrimaryClassification: row.ours.classification, missingHandlerObservedIn: missing.caseId, status: missing.report.result.exitCode, stderrBase64: missing.report.result.stderrBase64, sourceDefaultRegistryContainsTarget: primary.report.registeredNames.includes(row.name), frozenConcreteKernelContainsTarget: inputs.dispatch.ours.kernel.includes(row.name), operationalCredit: false, workflowEquivalenceClaim: false },
    baseline: { operationalClassification: baselineClassification, frozenRawClassification: row.baseline.classification, operationalCredit: row.baseline.operationalCredit, result: baselineCapture.report.result, failures: row.baseline.failures, productElapsedMs: baselineCapture.report.productElapsedMs, cleanChildExit: baselineCapture.exitCode === 0 && !baselineCapture.signal, fullCensusCaptured: baselineCapture.report.before.complete && baselineCapture.report.after.complete },
    raw: row.rawPaths,
  };
});
assert.equal(meaningfulRows.length, 54);
const tally = (rows, engine) => rows.reduce((counts, row) => { const label = row[engine].operationalClassification; counts[label] = (counts[label] ?? 0) + 1; return counts; }, {});
const first = json(`${owned}/attempt-001/results.json`);
const firstRaw = readdirSync(`${owned}/attempt-001/raw`).filter(name => name.endsWith(".json")).map(name => json(`${owned}/attempt-001/raw/${name}`));
assert.equal(firstRaw.length, 132);
const firstExceptions = firstRaw.filter(capture => capture.signal !== null || capture.exitCode !== 0).map(capture => ({ id: capture.caseId, engine: capture.engine, signal: capture.signal, exitCode: capture.exitCode, reason: capture.terminationReason, phases: capture.phases, reportCaptured: Boolean(capture.report) }));
const post = json(`${destination}/post-run.json`);
const priorSource = new Map(manifest.source.entries.map(entry => [entry.path, entry]));
const liveDrift = post.liveSource.entries.filter(entry => priorSource.get(entry.path)?.sha256 !== entry.sha256).map(entry => ({ path: entry.path, frozenSha256: priorSource.get(entry.path)?.sha256 ?? null, liveAfterSha256: entry.sha256 }));
const jsCapture = captures.find(capture => capture.caseId === "js-exec-positive" && capture.engine === "baseline");
const jsSpecimen = inputs.cases.find(specimen => specimen.id === "js-exec-positive");
const jsSemantics = {
  statusMatches: jsCapture.report.result.exitCode === jsSpecimen.expected.exitCode,
  stdoutMatches: jsCapture.report.result.stdoutBase64 === jsSpecimen.expected.stdoutBase64,
  stderrMatches: jsCapture.report.result.stderrBase64 === jsSpecimen.expected.stderrBase64,
  completeCensus: jsCapture.report.before.complete && jsCapture.report.after.complete,
  stableNamespaceEffects: effects(jsCapture.report.before, jsCapture.report.after),
  operationalCredit: false, lifecycleAccepted: false,
  reason: "Guest result succeeded; process retained resources beyond10s cleanup. Parent SIGTERM is exceptional. No claim of product-exec timeout or missing runtime, no causal conclusion about tracing.",
};
const summary = {
  historicalPreserved: inventory.historical,
  counts: { historicalRows: 53, addedOptionalRows: 4, primaryTargetNames: 54, defaultTargetNames: 50, optionalTargetNames: 4, primaryRecipes: 61, historicalOverlapRecipes: 3, sharedControlRecipes: 4, diagnosticRecipes: 7, correctedLaunches: 136, correctedProductCalls: 136, correctedReports: 136, correctedNormalExits: 135, correctedExceptionalExits: 1, firstLaunches: 132, firstProductCalls: first.counts.actualProductExecCalls, firstReports: firstRaw.filter(capture => capture.report).length, firstNormalExits: first.counts.normalChildren, firstExceptionalExits: firstExceptions.length, totalLaunches: 268, totalProductCalls: first.counts.actualProductExecCalls + 136, totalNormalExits: first.counts.normalChildren + 135, totalExceptionalExits: firstExceptions.length + 1, primary54: { ours: tally(meaningfulRows, "ours"), baseline: tally(meaningfulRows, "baseline") }, default50: { ours: tally(meaningfulRows.filter(row => row.cohort === "historical-unmeasured"), "ours"), baseline: tally(meaningfulRows.filter(row => row.cohort === "historical-unmeasured"), "baseline") }, configuredSetupUnavailable: { ours: 0, baseline: 0 }, configuredDefaultDisabled: { ours: 0, baseline: 0 } },
  optionalSafejsOutsideTargetCensus: { available: false, name: "safejs", reason: inputs.comparisonPolicy.optionalSafejs, legitimateRuntimeInjected: false, executionAttempted: false, includedIn54: false, missingWorkflowClaim: false },
  jsSemantics, firstExceptions, correctedExceptions: exceptions, integrity: results.integrity, liveDrift,
  census: { all136BeforeAfterComplete: true, entriesBefore: captures.reduce((total, capture) => total + capture.report.before.entries.length, 0), entriesAfter: captures.reduce((total, capture) => total + capture.report.after.entries.length, 0), bytesBefore: captures.reduce((total, capture) => total + capture.report.before.bytes, 0), bytesAfter: captures.reduce((total, capture) => total + capture.report.after.bytes, 0), normalizedMissingFields: false },
  comparisonBoundaries: inputs.comparisonPolicy,
  qualifications: ["No new native reference executions: predetermined workflow expectations, not universal Bash/GNU/POSIX oracle", "Tree traversed correctly but emitted ASCII C-locale connectors versus prepared Unicode expected bytes; strict failure retained, not missing traversal", "Ours wait primary was rejected by parser for &, not a no-op wait implementation; direct wait diagnostic independently returned127", "Binary control mismatches baseline file bytes as well as terminal byte API; no pipe corruption claim from this non-pipeline case", "Shared curl and census output modes differ (ours0666, baseline0644); bounded recipe success is not exact full-effect parity", "Hash proves map retrieval, not hashed dispatch; help/wait/node have no operational credit", "One corrected JavaScript cleanup failure keeps strict all-normal validation red", "Historical SGID/env-order normative records are not rerun or reclassified; Darwin-specific profile evidence is not universal POSIX/Linux"],
  cleanup: { fixtureServerClosed: json(`${destination}/network.json`).serverClosed, allLaunchedChildrenExited: true, allChildrenNormal: false, noSIGKILL: ![...firstRaw, ...captures].some(capture => capture.forceKilled), snapshotRetainedForReviewer: inputs.paths.snapshot, noNativeFixtureTree: true, noProductEdits: true, noInstalls: true },
};
publish(`${destination}/meaningful-matrix.json`, { historicalRows: matrix.rows, additionalOptionalRows: matrix.additionalOptional, targets: meaningfulRows, historicalOverlap: results.observations.filter(row => row.cohort === "historical-measured-control"), sharedControls: results.observations.filter(row => row.cohort.startsWith("shared")), summary });
publish(`${destination}/summary.json`, summary);
publish(`${destination}/evidence-validation.json`, { status: "EVIDENCE_INTEGRITY_PASS_WITH_LIFECYCLE_GATE_FAILED", validationModule: evidence(`${owned}/finalize-audit.mjs`), assertions: { all136RawResultsPresent: true, all136AssessmentsRecomputedWithoutChanges: true, all136CaseHashes: true, snapshotAndConfigAndDependenciesAndHarnessUnchanged: true, allObservedModulePathsBound: true, originalPreparationHashesUnchanged: true, original53RowsAnd4OptionalRowsRetained: true, exact54TargetNamesConfirmedMissingOnOursByActualDispatch: true, completeBeforeAfterCensuses: true, cleanLifecycleGate: false }, exceptions, artifacts });
console.log(JSON.stringify({ counts: summary.counts, integrity: summary.integrity, strictNormalExitGate: "FAIL (preserved)", evidenceIntegrity: "PASS" }, null, 2));

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
assert.equal(root, "/Users/kjopek/Workspace/safe-bash");
const commits = {
  freeze: "db3680fcfa91a7fff6ca0dad332c297094d14783",
  gateSource: "b494675c34dc289f4ad4b10a9201e1211eb0a7d8",
  featureSource: "84ab66ca717e0dff21abf57051b41cb553f3c7f3",
  gateEvidence: "954406871fae381b1c69441b34946a224201d7ad",
  acceptedEvidence: "8ab677479e0094ec0c6cdf90d1f0e87883b2f8dc",
  acceptedFixture: "8b6bcf83745727a45232c96de79a030fe98fb388",
  reviewFreeze: "fbd4a2c4c8c8215bbc04a1ab923af47e1bd64d22",
  priorClassification: "106e2951da6c8a0ea033eb7626e167400c5b19da",
};
const gate = "tests/integration/full-gate-20260827/combined-b494675c/";
const review = "tests/shell-stress/env-split-validity-review/";
const owned = path.relative(root, directory) + "/";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const blobHash = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const run = (args, allowed = [0]) => {
  const result = spawnSync("git", args, { cwd: root, timeout: 20000, maxBuffer: 40 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.ok(allowed.includes(result.status), result.stderr?.toString());
  return result;
};
const git = (...args) => run(args).stdout;
const artifactBindings = {};
const committed = (commit, name) => git("show", `${commit}:${name}`);
const evidence = (commit, name) => {
  const bytes = committed(commit, name);
  assert.equal(hash(fs.readFileSync(path.join(root, name))), hash(bytes), `Published evidence changed: ${name}`);
  artifactBindings[name] = { commit, sha256: hash(bytes), gitBlob: blobHash(bytes), bytes: bytes.length };
  return bytes;
};
const originalFiles = git("ls-tree", "-r", "--name-only", commits.priorClassification, "--", owned).toString().trim().split("\n");
assert.equal(originalFiles.length, 6);
for (const name of originalFiles) evidence(commits.priorClassification, name);
const manifest = JSON.parse(evidence(commits.gateEvidence, gate + "EVIDENCE_MANIFEST.json"));
const captureTree = Object.fromEntries(git("ls-tree", "-r", "-z", commits.gateEvidence, "--", gate + "evidence").toString().split("\0").filter(Boolean).map(line => {
  const [metadata, name] = line.split("\t");
  return [name, metadata.split(" ")[2]];
}));
const captureBindings = {};
const capture = key => {
  const entry = manifest.captures.find(item => item.key === key);
  assert.ok(entry, key);
  const name = gate + entry.path;
  const stored = fs.readFileSync(path.join(root, name));
  assert.equal(blobHash(stored), captureTree[name], name);
  assert.equal(hash(stored), entry.storedSha256, name);
  const decoded = entry.encoding === "identity" ? stored : gunzipSync(Buffer.from(stored.toString(), "base64"));
  assert.equal(decoded.length, entry.originalBytes);
  assert.equal(hash(decoded), entry.originalSha256);
  captureBindings[key] = { path: name, encoding: entry.encoding, storedSha256: entry.storedSha256, decodedSha256: entry.originalSha256, decodedBytes: decoded.length, gitBlob: captureTree[name] };
  return decoded;
};
const gateReport = JSON.parse(capture("canonical/report.json"));
const routing = JSON.parse(evidence(commits.gateEvidence, gate + "FAILURE_ROUTING.json"));
assert.equal(gateReport.revision, commits.gateSource);
assert.equal(routing.failures.filter(row => row.group === "env-S-preimplementation").length, 84);
const testPhase = gateReport.phases.find(phase => phase.label === "test");
assert.equal(testPhase.status, 1);
assert.equal(gateReport.status, "infrastructure-failed");
const parents = Object.fromEntries(Object.entries(commits).map(([label, commit]) => [label, { commit, parents: git("show", "-s", "--format=%P", commit).toString().trim().split(" "), tree: git("rev-parse", `${commit}^{tree}`).toString().trim() }]));
assert.deepEqual(parents.featureSource.parents, [commits.gateSource]);
const ancestry = {
  featureIsAncestorOfGate: run(["merge-base", "--is-ancestor", commits.featureSource, commits.gateSource], [0, 1]).status === 0,
  gateIsAncestorOfFeature: run(["merge-base", "--is-ancestor", commits.gateSource, commits.featureSource], [0, 1]).status === 0,
  freezeIsAncestorOfGate: run(["merge-base", "--is-ancestor", commits.freeze, commits.gateSource], [0, 1]).status === 0,
};
assert.deepEqual(ancestry, { featureIsAncestorOfGate: false, gateIsAncestorOfFeature: true, freezeIsAncestorOfGate: true });
const inputs = ["tests/shell/env-split-native.test.ts", "tests/shell/env-split-host.test.ts", ...["resume-fixtures.ts", "resume-host.ts", "native-frozen.json", "resume-native.json", "resume-cases.json"].map(name => "tests/shell-stress/env-split-author/" + name)];
const sources = ["src/index.ts", "src/plugins/index.ts", "src/commands/index.ts", "src/shell/index.ts", "src/shell/shell.ts", "src/shell/runtime.ts", "src/commands/execution.ts"];
const fileBindings = {};
for (const name of [...inputs, ...sources]) {
  const profiles = Object.fromEntries(["freeze", "gateSource", "featureSource"].map(label => {
    const bytes = committed(commits[label], name);
    return [label, { sha256: hash(bytes), gitBlob: blobHash(bytes), bytes: bytes.length }];
  }));
  const copied = gateReport.sourceHashes[name];
  const discovered = gateReport.discovery.tree.find(entry => entry.path === name);
  assert.equal(copied.sha256, profiles.gateSource.sha256);
  assert.equal(copied.bytes, profiles.gateSource.bytes);
  assert.equal(copied.symlink, false);
  assert.equal(discovered.blob, profiles.gateSource.gitBlob);
  assert.ok(!testPhase.sourceChanges.includes(name));
  if (inputs.includes(name)) assert.ok(Object.values(profiles).every(value => value.sha256 === profiles.gateSource.sha256));
  fileBindings[name] = { ...profiles, actualCopiedInput: copied, discoveryGitEntry: discovered, unchangedThroughTestPhase: true };
}
const parserPath = "src/commands/env-split.ts";
const parserPresence = {};
for (const label of ["freeze", "gateSource", "featureSource"]) {
  const present = git("ls-tree", commits[label], "--", parserPath).length > 0;
  parserPresence[label] = { present, sha256: present ? hash(committed(commits[label], parserPath)) : null };
}
assert.equal(parserPresence.gateSource.present, false);
assert.equal(parserPresence.featureSource.present, true);
assert.equal(gateReport.sourceHashes[parserPath], undefined);
const excerpts = {};
const excerpt = (name, commit, first, last) => {
  const bytes = committed(commit, name);
  excerpts[name] = { commit, sha256: hash(bytes), firstLine: first, lastLine: last, text: bytes.toString().split("\n").slice(first - 1, last).join("\n") };
};
for (const name of ["run.mjs", "inspect.mjs", "import-guard.mjs"]) {
  const bytes = evidence(commits.gateEvidence, gate + name);
  assert.equal(hash(bytes), gateReport.harnessHashes[name]);
}
excerpt(gate + "run.mjs", commits.gateEvidence, 83, 110);
excerpt(gate + "import-guard.mjs", commits.gateEvidence, 8, 23);
excerpt("tests/shell/env-split-host.test.ts", commits.gateSource, 18, 22);
excerpt("tests/shell-stress/env-split-author/resume-fixtures.ts", commits.gateSource, 1, 3);
const fixtureText = committed(commits.gateSource, inputs[2]).toString();
const hostText = committed(commits.gateSource, inputs[3]).toString();
assert.ok(!fixtureText.includes("process.env") && !hostText.includes("process.env"));
assert.ok(fixtureText.includes('from "../../../src/index.js"'));
assert.ok(hostText.includes('from "../../../src/index.js"'));
assert.ok(!fixtureText.includes("resume-verify") && !hostText.includes("resume-verify"));
const moduleProcesses = [];
let scannedLogs = 0;
let scannedRecords = 0;
const scanBindings = [];
for (const entry of manifest.captures.filter(item => item.key.startsWith("canonical/imports/test/"))) {
  const rows = capture(entry.key).toString().trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  scannedLogs++;
  scannedRecords += rows.length;
  scanBindings.push([entry.key, entry.originalSha256]);
  const local = filename => filename.slice(gateReport.source.length + 1);
  const entryRecord = rows.find(row => [inputs[0], inputs[1], inputs[3]].some(name => row.resolved === gateReport.source + "/" + name));
  if (!entryRecord) continue;
  const observation = testPhase.observed.find(row => row.pid === entryRecord.pid);
  assert.ok(observation, `No observed process ${entryRecord.pid}`);
  const sourceRows = rows.filter(row => row.resolved.startsWith(gateReport.source + "/src/"));
  for (const row of sourceRows) assert.equal(row.sha256, gateReport.sourceHashes[local(row.resolved)].sha256);
  assert.equal(rows.filter(row => row.resolved.startsWith(gateReport.source + "/dist/")).length, 0);
  assert.equal(rows.filter(row => /\/env-split\.(?:ts|js)$/.test(row.resolved)).length, 0);
  const targets = rows.filter(row => [...inputs.slice(0, 4), "src/index.ts", "src/shell/runtime.ts", "src/commands/execution.ts"].includes(local(row.resolved)));
  for (const row of targets) assert.equal(row.sha256, fileBindings[local(row.resolved)].gateSource.sha256);
  const role = entryRecord.resolved.endsWith("resume-host.ts") ? "host-child" : entryRecord.resolved.endsWith("env-split-native.test.ts") ? "native-test" : "host-parent";
  if (role !== "host-parent") for (const name of ["src/index.ts", "src/shell/runtime.ts", "src/commands/execution.ts"]) assert.ok(targets.some(row => local(row.resolved) === name));
  moduleProcesses.push({ pid: entryRecord.pid, role, processObservation: observation, capture: captureBindings[entry.key], sourceResolutionCount: sourceRows.length, sourceResolutionDigest: hash(Buffer.from(JSON.stringify(sourceRows))), selectedActualResolutionRecords: targets });
}
assert.equal(moduleProcesses.length, 27);
assert.equal(moduleProcesses.filter(row => row.role === "host-child").length, 25);
assert.equal(moduleProcesses.filter(row => row.role === "native-test").length, 1);
assert.equal(moduleProcesses.filter(row => row.role === "host-parent").length, 1);
assert.equal(testPhase.observed.filter(row => row.command.includes("/resume-host.ts ")).length, 25);
const nativePid = moduleProcesses.find(row => row.role === "native-test").pid;
const hostParentPid = moduleProcesses.find(row => row.role === "host-parent").pid;
const rawTap = capture("canonical/test.stdout.log").toString();
assert.match(rawTap, /^ok \d+ - env split imports the current TypeScript product$/m);
const audit = JSON.parse(evidence(commits.acceptedEvidence, review + "post-v2-audit.json"));
const accepted = JSON.parse(evidence(commits.acceptedEvidence, review + "acceptance-v2-1.json"));
const verdict = evidence(commits.acceptedEvidence, review + "V2_REVIEW.md").toString();
assert.ok(verdict.includes("ACCEPT bounded core integration using the disclosed valid v2 fixtures"));
assert.equal(audit.attempt.sha256, artifactBindings[review + "acceptance-v2-1.json"].sha256);
assert.equal(accepted.sourceCommit, commits.featureSource);
assert.equal(accepted.completed, true);
assert.equal(accepted.fixtureCommit, commits.acceptedFixture);
assert.equal(accepted.reviewFreezeCommit, commits.reviewFreeze);
assert.notEqual(audit.authorThreadId, audit.reviewerThreadId);
const sourceManifest = accepted.manifests[accepted.sourceBefore];
for (const [name, expected] of Object.entries(sourceManifest)) assert.equal(hash(committed(commits.featureSource, name)), expected, name);
assert.equal(Object.keys(sourceManifest).length, 220);
const productPhases = accepted.phases.filter(phase => phase.loaded);
assert.equal(productPhases.length, 191);
const installed = accepted.manifests[accepted.installedBefore];
const packed = accepted.manifests[accepted.packedFiles];
const emitted = accepted.manifests[accepted.emitted];
let compiledLoads = 0;
for (const phase of productPhases) {
  assert.equal(phase.packageBefore, phase.packageAfter);
  assert.equal(phase.sourceBefore, phase.sourceAfter);
  assert.equal(phase.inputBefore, phase.inputAfter);
  const loaded = accepted.manifests[phase.loaded];
  assert.equal(Object.keys(loaded).length, 174);
  assert.ok(loaded["dist/commands/env-split.js"]);
  for (const [name, expected] of Object.entries(loaded)) {
    assert.equal(expected, installed[name]);
    assert.equal(expected, packed[name]);
    assert.equal(expected, emitted[name.slice(5)]);
  }
  compiledLoads += Object.keys(loaded).length;
}
assert.equal(compiledLoads, 33234);
assert.equal(accepted.summary.childProcesses, 195);
const hiddenCounts = accepted.summary.hidden.map(summary => {
  const rows = accepted.hidden.filter(row => row.profile === summary.profile);
  const commands = rows.filter(row => row.category === "command");
  const protocols = rows.filter(row => row.category === "single-optional");
  assert.equal(rows.length, 48);
  assert.equal(commands.filter(row => row.exact).length, summary.command.strictExact);
  assert.equal(protocols.filter(row => row.exact).length, summary.protocol.strictExact);
  assert.equal(rows.filter(row => row.additionalVirtualDiagnosticProfile).length, summary.additionalVirtualDiagnosticChecks);
  return summary;
});
const diagnosticArgv = {
  "packed-non-s-single-operand": ["env", "argvprobe two words"],
  "missing-command-negative": ["env", "-S", "env-split-never-a-real-command argument"],
  "nonexecutable-command-negative": ["env", "-S", "./nonexec argument"],
};
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const textTuple = (tuple, encoding) => ({ ...tuple, stdoutText: Buffer.from(encoding === "hex" ? tuple.stdoutHex : tuple.stdout, encoding).toString(), stderrText: Buffer.from(encoding === "hex" ? tuple.stderrHex : tuple.stderr, encoding).toString() });
const diagnostics = Object.entries(diagnosticArgv).map(([id, argv]) => {
  const row = accepted.hidden.find(row => row.id === id && row.profile === "gnu97-darwin-primary");
  assert.equal(row.actual.result.source, argv.map(quote).join(" "));
  assert.deepEqual(row.fields, { status: true, stdout: true, stderr: false, effects: true });
  assert.equal(row.additionalVirtualDiagnosticProfile, true);
  return { id, profile: row.profile, inputSha256: row.inputSha256, literalArgv: argv, shellSource: row.actual.result.source, native: textTuple(row.expected, "base64"), virtual: textTuple(row.tuple, "base64"), strictNativeExact: false, additionalVirtualDiagnosticCheck: true, effectsClassification: "Exact unchanged seeded files/modes; no successful target dispatch. Status/stdout/effects match; only diagnostic bytes differ" };
});
const hiddenHeaders = { "plain-bash": "bash", "non-s-packed-bash-option": "bash -e", "split-errexit": "-S bash -e", "split-assignment-and-clear": "-S -i MARK=kept bash -e", "split-long-plus-option": "--split-string=bash +e", "split-quoted-marker": '-S MARK="two words" bash -e' };
const hiddenCasePath = "tests/shell-stress/env-split-holdout/cases.mjs";
const hiddenCaseText = evidence(commits.acceptedEvidence, hiddenCasePath).toString();
const hiddenProtocols = accepted.hidden.filter(row => row.profile === "gnu97-darwin-primary" && row.category === "single-optional").map(row => {
  assert.ok(hiddenCaseText.includes(`{ id: '${row.id}', optional: '${hiddenHeaders[row.id]}' }`));
  return { id: row.id, header: "#!/usr/bin/env " + hiddenHeaders[row.id], profile: row.profile, inputSha256: row.inputSha256, shellSource: row.actual.result.source, native: textTuple(row.expected, "base64"), virtual: textTuple(row.tuple, "base64"), strictExact: row.exact, supportedCoreCredit: 0 };
});
assert.equal(hiddenProtocols.filter(row => !row.strictExact).length, 5);
const packedHeaders = { "shebang-split-bash-errexit": "-S bash -e", "shebang-long-split-sh-argv": "--split-string=sh -e", "non-split-header-one-argument": "bash -e" };
const packedCasePath = "tests/shell-stress/env-split-validity/cases.mjs";
const packedCaseText = evidence(commits.acceptedFixture, packedCasePath).toString();
const packedProtocols = accepted.consumer.filter(row => row.kind === "native" && !row.supportedCore).map(row => {
  assert.ok(packedCaseText.includes(`{ id: '${row.id}', header: '${packedHeaders[row.id]}'`));
  assert.equal(row.actual.observations.length, 1);
  const observation = row.actual.observations[0];
  return { id: row.id, header: "#!/usr/bin/env " + packedHeaders[row.id], originalShellSource: observation.originalSource, revisedShellSource: observation.revisedSource, virtual: textTuple(observation.tuple, "hex"), nativeProfiles: row.profiles.map(profile => ({ ...profile, expected: textTuple(profile.expected, "hex") })), supportedCoreCredit: 0 };
});
assert.equal(packedProtocols.length, 3);
for (const role of ["primary", "historical"]) {
  const nativeRows = accepted.consumer.filter(row => row.kind === "native");
  assert.equal(nativeRows.length, 10);
  assert.equal(nativeRows.filter(row => row.profiles.find(profile => profile.role === role).exact).length, 7);
  assert.equal(nativeRows.filter(row => row.supportedCore && row.profiles.find(profile => profile.role === role).exact).length, 7);
}
assert.equal(accepted.hosts.length, 7);
assert.ok(accepted.hosts.every(row => !row.failure));
const packedHosts = accepted.consumer.filter(row => row.kind !== "native").map(row => ({ id: row.id, executions: row.actual.observations.length, observations: row.actual.observations.map(observation => ({ variant: observation.variant, error: observation.error, sameReason: observation.sameReason, disposed: observation.disposed })) }));
assert.equal(packedHosts.reduce((total, row) => total + row.executions, 0), 5);
assert.equal(accepted.controls.observations.filter(row => row.passed).length, 12);
const independentControls = accepted.independentControls.map(row => ({ group: row.group, passed: row.passed, runtimeVariants: row.observations.length }));
assert.equal(independentControls.filter(row => row.passed).length, 6);
assert.equal(independentControls.reduce((total, row) => total + row.runtimeVariants, 0), 14);
const authorSeal = JSON.parse(evidence(commits.acceptedEvidence, "tests/shell-stress/env-split-validity/author-seal-v2.json"));
const refusal = JSON.parse(evidence(commits.acceptedEvidence, review + "post-attempt-audit.json"));
for (const name of ["consumer-v2.mjs", "hidden-v1.mjs"]) excerpt("tests/shell-stress/env-split-validity/" + name, commits.acceptedFixture, 12, 29);
const keyCompiled = Object.fromEntries(["dist/index.js", "dist/shell/runtime.js", "dist/commands/execution.js", "dist/commands/env-split.js"].map(name => [name, installed[name]]));
const selectedCaptureKeys = new Set(["canonical/report.json", "canonical/test.stdout.log", ...moduleProcesses.map(row => manifest.captures.find(entry => gate + entry.path === row.capture.path).key)]);
const proof = {
  schema: "env-gate-source-loader-clarification-v1", date: "2026-08-27", commits, parents, ancestry,
  conclusion: "Gate source selection, not fixture overlay or hidden helper pin: b494 is the feature commit's immediate parent and already contains all seven committed prospective env inputs; the actual cohort resolves b494 TypeScript source",
  priorClassificationUnchanged: { commit: commits.priorClassification, protectedFiles: originalFiles, counts: { A: 0, B: 0, C: 0, D: 84, unknown: 0 }, proposedMigrationPaths: [] },
  sourceArchive: { recordedRevision: gateReport.revision, recordedArchiveSha256: gateReport.archiveSha256, sourceRoot: gateReport.source, allTrackedFiles: gateReport.discovery.trackedFiles, binding: "Runner archives the whole named commit and verifies each extracted byte count/Git blob before recording sourceHashes. The old scratch archive is not re-created in this clarification", actualCanonicalIncludesBothTests: inputs.slice(0, 2).every(name => gateReport.actualCanonicalFiles.includes(name)), liveHeadAtExecution: gateReport.liveBefore.head, liveStatusSha256: hash(Buffer.from(gateReport.liveBefore.status)), liveDirtyStateIsNotCopiedSource: true, harnessHashes: gateReport.harnessHashes },
  fileBindings, parserPresence,
  sourceDelta: { changedPaths: git("diff", "--name-status", commits.gateSource, commits.featureSource, "--", "src").toString().trim().split("\n"), patchSha256: hash(git("diff", commits.gateSource, commits.featureSource, "--", "src")), targetFixtureDelta: git("diff", commits.freeze, commits.featureSource, "--", ...inputs).toString() },
  loader: { execution: { executable: testPhase.executable, args: testPhase.args, cwd: testPhase.cwd }, nativeTestPid: nativePid, hostParentPid, hostChildren: 25, cohortProcesses: 27, totalScannedImportLogs: scannedLogs, totalScannedResolutionRecords: scannedRecords, importScanDigest: hash(Buffer.from(JSON.stringify(scanBindings))), moduleProcesses, hostHelperProcessEnvReads: false, fixtureProcessEnvReads: false, nativeJsonRole: "Expected raw data, never an alternate product loader", actualProductFormat: "Candidate-relative .js specifiers resolve through tsx to scratch .ts; no dist/product parser records in these27 logs", proofLimit: "Broad guard is a resolve hook: it records actual resolved realpaths and file hashes, not parentURL/specifier edges, a load-hook trace, transformed JS bytes, or evaluation attestation. Input manifests plus per-process resolution/process/TAP evidence bind this cohort; they do not qualify the whole gate" },
  gateLimits: { status: gateReport.status, historicalCounts: { tests: 16840, pass: 16520, fail: 307, skip: 13 }, sourceChangesDuringTest: testPhase.sourceChanges, originalError: gateReport.error.message, nativePrerequisiteMissingIsNotProductFailure: true, rawCountsUnchanged: true },
  acceptedCore: {
    verdictCommit: commits.acceptedEvidence, disposition: audit.disposition, sourceCommit: accepted.sourceCommit, fixtureCommit: accepted.fixtureCommit, reviewFreeze: accepted.reviewFreezeCommit, reviewerThreadId: audit.reviewerThreadId, authorThreadId: audit.authorThreadId,
    independentExecution: { started: accepted.started, finished: accepted.finished, completed: accepted.completed, productProcesses: productPhases.length, allChildProcesses: accepted.phases.length, actualCompiledLoads: compiledLoads, loadedFilesPerProduct: 174, freshNativeRuns: accepted.freshNativeRuns },
    sourcePackage: { sourceManifest: accepted.sourceBefore, sourceManifestFilesRecheckedAgainstGit: Object.keys(sourceManifest).length, sourceArchiveSha256: accepted.sourceArchiveSha256, tarball: accepted.tarball, move: accepted.move, packageName: accepted.package.name, runtimeDependencies: accepted.package.dependencies ?? {}, keyCompiled, sourceAfter: accepted.sourceAfter, installedBefore: accepted.installedBefore, installedAfter: accepted.installedAfter, emittedManifest: accepted.emitted, emittedFiles: Object.keys(emitted).length, packageFiles: Object.keys(installed).length, sampleActualPublicResolution: accepted.consumer[0].actual.resolved, guardKind: "Frozen consumer/hidden load hooks admit only moved package dist/*.js and hash disk bytes before nextLoad; all191 per-process loaded hashes match installed, packed and emitted manifests. Not a trusted-JavaScript sandbox" },
    currentHiddenProfiles: hiddenCounts, currentHiddenHostIds: accepted.hosts.map(row => row.id), currentPackedProfiles: accepted.summary.consumer, currentPackedHosts: packedHosts, additionalAuthorDefinedPolicyControls: { total: 12, passed: 12, executedByIndependentReviewer: true }, independentControls,
    nativeProfiles: { hidden: accepted.nativeProfiles.hidden.map(({ id, env, envHash, bash, bashHash, rows, reusedImmutableCapture }) => ({ id, env, envHash, bash, bashHash, rows, reusedImmutableCapture })), packed: { env: { path: accepted.nativeProfiles.consumer.tool.path, hash: accepted.nativeProfiles.consumer.tool.hash }, bashParents: accepted.nativeProfiles.consumer.profiles.map(({ role, binary, hash, rows, originalControlsRetained, reusedImmutableCapture }) => ({ role, binary, hash, rows, originalControlsRetained, reusedImmutableCapture })), protocol: "Original packed native references include actual Darwin-kernel invocation; explicit single-optional controls remain separate. Packed historical means GNU env9.7 with Apple Bash3.2, NOT Apple env. No per-case profile merging" } },
    retainedDiagnosticLosses: diagnostics, hiddenProtocolRows: hiddenProtocols, packedProtocolRows: packedProtocols,
    separateAuthorRevision: { role: authorSeal.role, sourceCommit: authorSeal.sourceCommit, fixtureCommit: authorSeal.fixtureCommit, productProcesses: authorSeal.productProcesses, childProcesses: authorSeal.summary.childProcesses, summary: authorSeal.summary, authorCountsUsedAsIndependentOracle: false },
    preservedOriginalInvalidFixtures: { hidden: accepted.summary.originalHidden, hiddenHosts: accepted.summary.originalHosts, packed: accepted.summary.originalConsumer, packedHosts: accepted.summary.originalConsumerHosts, contributesToCurrentAcceptedDenominator: false },
    preservedV1Refusal: { disposition: refusal.disposition, attempt: refusal.attempt, summary: refusal.summary, productProcesses: refusal.guards.productProcesses, contributesToCurrentAcceptedDenominator: false },
    acceptedCleanup: { scratchAbsent: audit.cleanup.scratchAbsent, allAbsentAtPostAudit: audit.cleanup.allAbsentAtPostAudit, watchdogs: audit.cleanup.watchdogs, timeouts: audit.cleanup.timeouts, overflows: audit.cleanup.overflows },
  },
  repeatAvoidanceProposal: ["Before execution, assert requested feature commit is an ancestor of the exact candidate (git merge-base --is-ancestor), and assert expected feature file/hash at that commit. b494 fails both guards", "Bind full candidate Git archive and required source/test/helper/native-input hashes before discovery; copy no live test/source overlay. Preserve diagnostics for any changed tracked input", "Bind the executed harness and inherited NODE_OPTIONS guard. Require per-cohort resolved paths/hashes against that exact archive; if a complete load trace is required, use a harness load hook, not a new shared product API", "Declare TS-source versus moved-package compiled-JS profiles separately; forbid fallback imports/overrides outside that profile. Retain whole native reference profiles and original failures", "Check native prerequisites and artifact immutability before any separately authorized broad gate. This addendum executes none"],
  excerpts, artifactBindings, captureBindings: Object.fromEntries(Object.entries(captureBindings).filter(([key]) => selectedCaptureKeys.has(key))),
  activity: { productExecutions: 0, nativeOracleExecutions: 0, dependencyInstalls: 0, scratchCreated: false, productOrOriginalFixtureEdits: false, originalEvidenceFilesUnchanged: true, onlyBoundedReadonlyGitChildren: true },
};
assert.equal(proof.sourceDelta.targetFixtureDelta, "");
assert.equal(proof.sourceArchive.actualCanonicalIncludesBothTests, true);
for (const name of originalFiles) assert.equal(hash(fs.readFileSync(path.join(root, name))), artifactBindings[name].sha256);
const destination = path.join(directory, "binding-machine-proof.json");
const text = JSON.stringify(proof, null, 2) + "\n";
if (fs.existsSync(destination)) assert.equal(fs.readFileSync(destination, "utf8"), text, "Never replace a prior proof");
else {
  const patch = `*** Begin Patch\n*** Add File: ${path.relative(root, destination)}\n${text.trimEnd().split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`;
  const result = spawnSync("apply_patch", [], { cwd: root, input: patch, encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
}
console.log(JSON.stringify({ ancestry, copiedInputs: inputs.length, cohortProcesses: moduleProcesses.length, nativeTestPid: nativePid, hostParentPid, productProcesses: productPhases.length, compiledLoads, diagnostics: diagnostics.length, hiddenProtocolLosses: hiddenProtocols.filter(row => !row.strictExact).length, packedProtocolLosses: packedProtocols.length, newProductOrNativeExecutions: 0 }));

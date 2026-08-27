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
  preparation: "db3680fcfa91a7fff6ca0dad332c297094d14783",
  originalAuthorBaseline: "e7f4f2e3753184415f8098445c2009cb4cd9a6e9",
  broadSource: "b494675c34dc289f4ad4b10a9201e1211eb0a7d8",
  broadEvidence: "954406871fae381b1c69441b34946a224201d7ad",
  productSource: "84ab66ca717e0dff21abf57051b41cb553f3c7f3",
  authorCoreSeal: "a84dd195c13935587df0d53be85c86790a48e4d5",
  canonicalInputs: "1a18cb1858f9453f41a20caff0988c578aa9c7e2",
  independentInputFreeze: "fbd4a2c4c8c8215bbc04a1ab923af47e1bd64d22",
  independentVerdict: "8ab677479e0094ec0c6cdf90d1f0e87883b2f8dc",
};
const relative = name => path.relative(root, path.join(directory, name));
const author = "tests/shell-stress/env-split-author/";
const review = "tests/shell-stress/env-split-validity-review/";
const broad = "tests/integration/full-gate-20260827/combined-b494675c/";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const run = (binary, args, options = {}) => {
  const result = spawnSync(binary, args, { cwd: root, timeout: 20000, maxBuffer: 40 * 1024 * 1024, ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};
const git = (...args) => run("git", args);
const read = name => fs.readFileSync(path.join(root, name));
const json = name => JSON.parse(read(name));
const artifacts = {};
const authenticate = (name, commit) => {
  const bytes = read(name);
  const committed = git("show", `${commit}:${name}`);
  assert.equal(hash(bytes), hash(committed), `Live evidence differs: ${name}`);
  artifacts[name] = { commit, sha256: hash(bytes), bytes: bytes.length };
  return bytes;
};
const lineOf = (text, needle) => {
  const offset = text.indexOf(needle);
  assert.notEqual(offset, -1, needle);
  return text.slice(0, offset).split("\n").length;
};
const routingPath = broad + "FAILURE_ROUTING.json";
const routing = JSON.parse(authenticate(routingPath, commits.broadEvidence));
const routed = routing.failures.filter(row => row.group === "env-S-preimplementation");
assert.equal(routed.length, 84);
assert.equal(new Set(routed.map(row => row.id)).size, 84);
assert.equal(new Set(routed.map(row => row.name)).size, 84);
assert.ok(routed.every(row => row.type === "test" && row.indent === 0 && row.failureType === "testCodeFailure"));
const rawPath = broad + "evidence/canonical/test.stdout.log.data.gzbase64";
const rawTap = gunzipSync(Buffer.from(authenticate(rawPath, commits.broadEvidence).toString(), "base64")).toString();
const tapLines = rawTap.split("\n");
for (const row of routed) {
  assert.equal(tapLines[row.line - 1], `not ok ${row.ordinal} - ${row.name}`);
  assert.equal(tapLines.slice(row.line, row.line + row.detail.split("\n").length).join("\n"), row.detail);
}
const replayPath = relative("canonical-replay.json");
const replay = json(replayPath);
assert.equal(replay.sourceCommit, commits.productSource);
assert.equal(replay.testCommit, commits.canonicalInputs);
assert.equal(replay.completed, true);
assert.equal(replay.passedTestNames.length, 89);
assert.deepEqual(replay.liveGuardChanges, []);
assert.deepEqual(replay.toolChanges, []);
assert.equal(replay.cleanup.scratchAbsent, true);
assert.equal(replay.cleanup.survivingHostCommands.length, 0);
assert.equal(replay.cleanup.hostReapingAssertions, 25);
artifacts[replayPath] = { sha256: hash(read(replayPath)), bytes: read(replayPath).length, role: "New bounded local classification replay, not an independent verdict" };
const inputPaths = Object.keys(replay.testInventory);
const inputHashes = {};
for (const name of inputPaths) {
  const currentHash = hash(read(name));
  assert.equal(currentHash, replay.testInventory[name]);
  inputHashes[name] = {};
  for (const [label, commit] of Object.entries(commits).filter(([label]) => ["preparation", "broadSource", "productSource", "canonicalInputs", "independentVerdict"].includes(label))) {
    const blob = git("show", `${commit}:${name}`);
    assert.equal(hash(blob), currentHash, `Canonical fixture changed at ${label}: ${name}`);
    inputHashes[name][label] = { sha256: hash(blob), gitBlob: git("rev-parse", `${commit}:${name}`).toString().trim() };
  }
  artifacts[name] = { commit: commits.canonicalInputs, sha256: currentHash, bytes: read(name).length };
}
const native = json(author + "native-frozen.json");
const supplemental = json(author + "resume-native.json");
const scenarios = json(author + "resume-cases.json");
const baseline = JSON.parse(authenticate(author + "resume-baseline.json", commits.preparation));
const authorValidation = JSON.parse(authenticate(author + "core-validation.json", commits.authorCoreSeal));
const core = JSON.parse(authenticate(author + "core-observed.json", commits.authorCoreSeal));
const coreSeal = JSON.parse(authenticate(author + "core-seal.json", commits.authorCoreSeal));
authenticate(author + "resume-red.txt", commits.preparation);
authenticate(author + "resume-validation.json", commits.preparation);
authenticate(author + "resume-source-inventory.json", commits.preparation);
authenticate(author + "resume-seal.json", commits.preparation);
authenticate(author + "CORE.md", commits.authorCoreSeal);
authenticate(author + "core-inputs.json", commits.authorCoreSeal);
const authorTestRun = authorValidation.commands.find(command => command.name === "author");
assert.equal(authorTestRun.status, 0);
for (const row of routed) assert.ok(authorTestRun.stdout.includes(`✔ ${row.name} (`), `No author pass for ${row.name}`);
const primaryRows = native.core.filter(row => row.profile === "GNU9.7-Darwin");
const supplementalRows = supplemental.rows.filter(row => row.profile === "GNU5.3");
const exact = [...primaryRows.filter(row => row.observed.status !== 127), ...supplementalRows];
assert.equal(exact.length, 59);
assert.equal(exact.filter(row => routed.some(route => route.name === `env split GNU raw tuple: ${row.name}`)).length, 59);
const hostSource = read(author + "resume-host.ts").toString();
const hostLines = hostSource.split("\n");
const scenariosStart = hostLines.findIndex(line => line.includes('if (scenario === "real-nested-pipeline")'));
const branchStarts = hostLines.map((line, index) => /(?:if|else if) \(scenario ===/.test(line) ? index : -1).filter(index => index >= 0);
const hostBranches = Object.fromEntries(branchStarts.flatMap((start, index) => {
  const end = branchStarts[index + 1] ?? hostLines.findIndex((line, lineIndex) => lineIndex > start && line === "  } else {");
  const names = [...hostLines[start].matchAll(/scenario === "([^"]+)"/g)].map(match => match[1]);
  return names.map(name => [name, { line: start + 1, source: hostLines.slice(start, end).join("\n") }]);
}));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const parseTuple = (detail, field) => {
  const pattern = new RegExp(`^  ${field}:\\n    status: (\\d+)\\n    stdoutHex: '([a-f0-9]*)'\\n    stderrHex: '([a-f0-9]*)'`, "m");
  const match = detail.match(pattern);
  assert.ok(match, field);
  return { status: Number(match[1]), stdoutHex: match[2], stderrHex: match[3] };
};
const profileFor = name => supplementalRows.some(row => row.name === name) ? "supplemental-GNU-env97-Darwin-Bash53" : "original-GNU-env97-Darwin-direct-exec";
const perRowProductHashes = {
  oldExecution: hash(git("show", `${commits.broadSource}:src/commands/execution.ts`)),
  currentExecution: hash(git("show", `${commits.productSource}:src/commands/execution.ts`)),
  currentParser: hash(git("show", `${commits.productSource}:src/commands/env-split.ts`)),
  unchangedRuntime: hash(git("show", `${commits.productSource}:src/shell/runtime.ts`)),
};
const hostStages = {
  "real-nested-pipeline": "Outer env rejects S before nested invocations; pipeline returns cat status0 with empty output and env diagnostic, not expected B=2 output",
  "export-local-cwd-parent": "S option rejection contaminates stderr before intended child env/cwd/local isolation assertions",
  "prefix-assignment-before-clear": "S option rejection returns2 before intended prefix-expansion/replacement dispatch",
  "binary-cursor-origin": "Forwarder's valid ByteSource reaches env but S rejection prevents binary child; stderr differs",
  "supplied-empty-origin": "S rejection returns2 before supplied-empty child provenance assertion",
  "bom-stderr-stdout": "S rejection returns2 before registered binary command can emit exact BOM bytes",
  "parse-before-chdir-effects": "Missing S option gives usage2, not parser125 for malformed ${9BAD}; no inference of new cwd bug",
  "unsupported-before-chdir": "Missing S option diagnostic, not generated --argv0=unsafe refusal; existing intended usage2 remains valid",
  "literal-injection-host-boundary": "S rejection prevents intended literal expansion/registered command dispatch",
  "shared-command-budget": "Expected maxCommands rejection absent because unsupported S returns before child dispatch",
  "shared-output-budget": "Old unsupported-option diagnostic itself exceeds maxOutputBytes4; throws before the positive child witness, not evidence child accounting is wrong",
  "shared-depth-budget": "Expected maxSubstitutionDepth rejection absent; S rejects before nested env dispatch",
  "shared-source-budget": "Expected maxSourceBytes rejection absent; S rejects before virtual bash entry",
  "shared-loop-budget": "Expected maxLoopIterations rejection absent; S rejects before virtual bash loop",
  "split-byte-cap": "Old usage2 versus bounded parser125; split-byte handling absent",
  "split-argument-cap": "Old usage2 versus bounded parser125; split-argument handling absent",
  "split-recursion-cap": "Old usage2 versus bounded parser125; split-expansion handling absent",
  "typed-cancel-cleanup-late-reject": "Typed cancellation rejection absent because S prevents entry/resource registration; not evidence of later cleanup failure",
  "cleanup-failure-identity": "Cleanup-error rejection absent because S prevents registered cleanup command entry",
  "blocked-input-cancel": "Cancellation rejection absent because S prevents cat/input read",
  "fallback-keeps-context": "Direct env fallback returns usage2 before report dispatch; required fallback context assertions remain valid",
  "sink-cancel-precedence": "Caller cancellation rejection absent because S prevents emit/stdout callback",
  "same-stream-split-does-not-consume": "S rejects with2 before report dispatch; untouched-input expectation remains valid",
};
const rows = routed.map(original => {
  assert.ok(replay.passedTestNames.includes(original.name));
  const host = original.file.endsWith("env-split-host.test.ts");
  const policy = original.name.startsWith("env split literal missing target,");
  const name = original.name.slice(original.name.indexOf(": ") + 2);
  const row = {
    id: original.id, classification: "D", qualified: true,
    test: {
      path: original.file, name: original.name,
      declarationLine: host ? 18 : policy ? 21 : 11,
      failedAssertionLine: host ? 38 : policy ? 23 : 13,
      sha256: replay.testInventory[original.file],
      transpiledTapLocation: original.location,
    },
    sourceProfile: { old: "b494-preimplementation", current: "84ab-unchanged-canonical", independentVerdict: "sealed-84ab-valid-v2-core" },
    productSha256: perRowProductHashes,
    wholeProfile: host ? "canonical-public-host-contract" : policy ? "literal-registry-missing-target-policy" : profileFor(name),
    originalRouting: { ...original, detail: host ? original.detail : undefined, detailSha256: hash(Buffer.from(original.detail)), detailReference: { path: routingPath, id: original.id, field: "detail" } },
    current: { canonicalTest: "pass", expectedUnchanged: true, capture: replayPath, assertionBearingCaseCount: 1, authorPassAlsoRecorded: true },
    migration: { required: false, mutablePaths: [], reason: "Existing expectation describes supported current behavior; rerun unchanged on the authorized source, never rewrite old capture" },
  };
  if (host) {
    const branch = hostBranches[name];
    assert.ok(branch, name);
    assert.ok(hostStages[name], name);
    row.scenario = { name, helper: author + "resume-host.ts", line: branch.line, helperSha256: replay.testInventory[author + "resume-host.ts"], source: branch.source, commonSetupProfile: "canonical-public-host-contract" };
    row.expected = { hostProcessStatus: 0, hostProcessStdout: JSON.stringify({ scenario: name, passed: true }) + "\n", hostProcessStderr: "", innerAssertions: "Exact branch source plus common cleanup/unhandled-rejection assertions; no single invented shell status for multi-call/rejection hosts" };
    row.actualOld = { hostProcessStatus: 1, assertionRecord: "originalRouting.detail retains exact inner diagnostic/expected/actual and outer process failure; missing inner tuples are not invented" };
    assert.match(original.detail, /^  expected: 0$/m);
    assert.match(original.detail, /^  actual: 1$/m);
    row.stage = hostStages[name];
    row.current.hostProcessStatus = 0;
    row.current.observation = "Unmodified parent test checks status, JSON result, signal, watchdog and reaped host PID; branch assertions pass";
  } else {
    const nativeRow = primaryRows.find(fixture => fixture.name === name) ?? supplementalRows.find(fixture => fixture.name === name);
    assert.ok(nativeRow, name);
    const supplementalScenario = scenarios.find(fixture => fixture.name === name);
    const args = nativeRow.args ?? supplementalScenario.args;
    const old = baseline.rows.find(fixture => fixture.name === name);
    const current = core.core.find(fixture => fixture.name === name);
    assert.ok(old && current);
    row.invocation = { command: "env", literalArgv: args, shellSource: ["env", ...args].map(quote).join(" "), helper: author + "resume-fixtures.ts", line: 55, helperSha256: replay.testInventory[author + "resume-fixtures.ts"], virtualEnvironment: { PATH: "", LC_ALL: "C", LANG: "C", TZ: "UTC", ...native.environment, ...supplementalScenario?.extraEnv }, virtualCwd: "/", directories: supplementalScenario?.directories ?? [] };
    row.nativeReference = { path: author + (supplementalScenario ? "resume-native.json" : "native-frozen.json"), sha256: replay.testInventory[author + (supplementalScenario ? "resume-native.json" : "native-frozen.json")], name, profile: nativeRow.profile, line: lineOf(read(author + (supplementalScenario ? "resume-native.json" : "native-frozen.json")).toString(), `"name": "${name}"`), observed: policy ? nativeRow.observed : "Exact expected tuple below", env: nativeRow.env, cwd: nativeRow.cwd, argv: nativeRow.argv ?? [native.envProfiles[0].binary, ...args] };
    row.originalAuthorBaseline = { sourceCommit: baseline.base, path: author + "resume-baseline.json", rowName: name, distinctFromBroadCapture: true, observationSha256: hash(Buffer.from(JSON.stringify(old))) };
    row.current.authorRawReference = { path: author + "core-observed.json", rowName: name, observationSha256: hash(Buffer.from(JSON.stringify(current))) };
    if (policy) {
      row.expected = { status: 127, stdoutHex: "", stderr: "Nonempty virtual registry diagnostic, deliberately NOT exact native stderr", entries: [], recorderCalls: 0 };
      row.actualOld = { status: 2, otherFields: "Not captured by this broad assertion; originalAuthorBaseline separately records them" };
      assert.match(original.detail, /^  expected: 127$/m);
      assert.match(original.detail, /^  actual: 2$/m);
      assert.equal(current.observed.status, 127);
      assert.notEqual(current.observed.stderrHex, "");
      assert.notEqual(current.observed.stderrHex, nativeRow.observed.stderrHex);
      row.current.authorRawObservation = current;
      row.stage = "Old S option rejection2 versus current successfully split literal missing target127; registry diagnostics remain intentionally distinct from native env host-exec diagnostics";
    } else {
      row.expected = parseTuple(original.detail, "expected");
      row.actualOld = parseTuple(original.detail, "actual");
      assert.deepEqual(row.expected, nativeRow.observed);
      assert.deepEqual(row.expected, current.observed);
      assert.deepEqual(row.actualOld, old.observed);
      row.current.authorTupleEqualsExpected = true;
      row.current.authorCalls = current.calls;
      row.current.authorEntries = current.entries;
      row.stage = `Old option-parser rejection2 (${Buffer.from(row.actualOld.stderrHex, "hex").toString().trim()}) before supported ${row.expected.status === 125 ? "invalid-grammar125 diagnostic" : "split/option/assignment/dispatch behavior"}`;
    }
  }
  return row;
});
const rawCanonical = tapLines.filter(line => /^(?:not )?ok \d+ - env split (?:bounded host:|GNU raw tuple:|literal missing target,|imports the current)/.test(line));
assert.equal(rawCanonical.length, 89);
assert.equal(rawCanonical.filter(line => line.startsWith("not ok ")).length, 84);
const unrouted = replay.passedTestNames.filter(name => !routed.some(row => row.name === name));
assert.equal(unrouted.length, 5);
for (const name of unrouted) assert.ok(rawCanonical.some(line => /^ok /.test(line) && line.endsWith(` - ${name}`)));
const reviewTextPath = review + "V2_REVIEW.md";
const verdictText = authenticate(reviewTextPath, commits.independentVerdict).toString();
assert.ok(verdictText.includes("ACCEPT bounded core integration using the disclosed valid v2 fixtures"));
const postAudit = JSON.parse(authenticate(review + "post-v2-audit.json", commits.independentVerdict));
const independent = JSON.parse(authenticate(review + "acceptance-v2-1.json", commits.independentVerdict));
authenticate(review + "review-freeze-v2.json", commits.independentInputFreeze);
authenticate(review + "V2_INPUTS.md", commits.independentInputFreeze);
assert.equal(postAudit.sourceCommit, commits.productSource);
assert.equal(independent.sourceCommit, commits.productSource);
assert.equal(independent.completed, true);
assert.equal(postAudit.guards.productProcesses, 191);
assert.equal(postAudit.controlEvidence.groups.length, 6);
assert.equal(independent.summary.independentControls.variants, 14);
assert.equal(postAudit.attempt.sha256, artifacts[review + "acceptance-v2-1.json"].sha256);
const sourceDiff = (before, after) => ({ before, after, diff: git("diff", "--name-status", before, after, "--", "src").toString().trim(), patchSha256: hash(git("diff", before, after, "--", "src")) });
const sourceProfiles = {};
for (const label of ["originalAuthorBaseline", "broadSource", "productSource", "canonicalInputs", "independentVerdict"]) {
  const commit = commits[label];
  sourceProfiles[label] = { commit, sourceTree: git("rev-parse", `${commit}:src`).toString().trim(), sources: {} };
  for (const name of ["src/commands/execution.ts", "src/shell/runtime.ts", "src/commands/internal.ts", "src/contracts/command.ts"]) sourceProfiles[label].sources[name] = hash(git("show", `${commit}:${name}`));
  if (!["originalAuthorBaseline", "broadSource"].includes(label)) sourceProfiles[label].sources["src/commands/env-split.ts"] = hash(git("show", `${commit}:src/commands/env-split.ts`));
}
assert.equal(sourceProfiles.productSource.sourceTree, sourceProfiles.canonicalInputs.sourceTree);
assert.equal(sourceProfiles.productSource.sourceTree, sourceProfiles.independentVerdict.sourceTree);
const counts = { routedRows: 84, uniqueTestCases: 84, aggregateParentRows: 0, hostCases: 23, exactNativeTupleCases: 59, literalMissingTargetPolicyCases: 2, A: 0, B: 0, C: 0, D: 84, unknown: 0 };
assert.equal(rows.filter(row => row.test.path.endsWith("host.test.ts")).length, counts.hostCases);
assert.equal(rows.filter(row => row.wholeProfile === "literal-registry-missing-target-policy").length, counts.literalMissingTargetPolicyCases);
const summary = {
  schema: "env-split-exact-routing-classification-v1", commits, counts,
  disposition: "D84: no live fixture migration proposed. Actual independent sealed verdict now available; no authorization inferred to edit tests or rebaseline history",
  classificationMeaning: { A: "Live canonical expectations obsolete under the supported feature; separately authorized narrow migration required", B: "Historical capture replay assertions that must retain their frozen original product/source profile", C: "Actual remaining product bugs", D: "Valid current canonical expectations failed only on the preimplementation source; no expectation migration" },
  broadGate: { qualification: routing.qualification, tests: 16840, pass: 16520, fail: 307, skip: 13, adjustedCounts: false, nativePrerequisiteAndArtifactWriterInvalidationRetained: true, routingSha256: artifacts[routingPath].sha256, originalTapDecodedSha256: hash(Buffer.from(rawTap)), encodedTapPath: rawPath, encodedTapSha256: artifacts[rawPath].sha256 },
  reconciliation: { canonicalTests: 89, nativeFile: { total: 64, exactTuples: 59, successfulTuples: 48, invalidGrammarTuples125: 11, policy: 4, importInventory: 1, failedBroad: 61 }, hostFile: { total: 25, failedBroad: 23 }, existingPassesNotRouted: unrouted, currentUnchangedCanonicalPass: 89, nativeTuplePassIsNotFullRawCohortPass: { originalRawTotal: 63, exact: 59, retainedDiagnosticMismatches: coreSeal.coreRaw.mismatches }, additionalAuthorLimitParentExcluded: { nodeTestCases: 1, innerControls: 10 }, nestedParentInflation: "None among these84: all indent0 type=test testCodeFailure. 23 host wrappers each map to one scenario, not 23 extra nested tests. Full baseline 89=84 failures+5 existing passes" },
  sourceProfiles,
  sourceDiffs: [sourceDiff(commits.originalAuthorBaseline, commits.broadSource), sourceDiff(commits.broadSource, commits.productSource), sourceDiff(commits.productSource, commits.canonicalInputs), sourceDiff(commits.productSource, commits.independentVerdict)],
  canonicalInputHashes: inputHashes,
  canonicalInputDiffs: { preparationToBroad: git("diff", "--name-status", commits.preparation, commits.broadSource, "--", ...inputPaths).toString(), broadToProduct: git("diff", "--name-status", commits.broadSource, commits.productSource, "--", ...inputPaths).toString(), productToCurrent: git("diff", "--name-status", commits.productSource, commits.canonicalInputs, "--", ...inputPaths).toString() },
  profiles: {
    "original-GNU-env97-Darwin-direct-exec": { platform: native.platform, release: native.release, arch: native.arch, env: native.envProfiles[0], recorderHash: native.recorderHash, environment: native.environment, execution: "Direct fixed GNU env9.7 binary, C recorder; original 41 non127 expected tuples. Darwin host, not GNU/Linux. Entire original GNU and Apple captures remain unchanged" },
    "supplemental-GNU-env97-Darwin-Bash53": { platform: supplemental.platform, release: supplemental.release, arch: supplemental.arch, env: supplemental.envProfile, bash: supplemental.profiles.find(profile => profile.name === "GNU5.3"), recorderHash: supplemental.recorderHash, execution: "Fixed GNU env9.7 via GNU Bash5.3 --noprofile --norc -c exec \"$@\"; 18 frozen supplemental expectations. Apple Bash3.2 full sibling reference retained; not per-row oracle switching" },
    "canonical-public-host-contract": { description: "Actual Shell + agentCommands, memory VFS, registered commands, middleware, inherited shared budgets, explicit ByteSource and cleanup. No native oracle; registry commands are not described as shell builtins", helperSha256: replay.testInventory[author + "resume-host.ts"], setup: hostLines.slice(0, scenariosStart).join("\n"), cleanup: hostLines.slice(hostLines.findIndex(line => line === "  assert.deepEqual(failures, []);")).join("\n"), bounds: { perHostMs: 4000, perTestMs: 6000, perHostOutputBytes: 262144 } },
    "literal-registry-missing-target-policy": { expected: "127, empty stdout, nonempty stderr, no rec dispatch, no VFS entries. Four original native127 diagnostic tuples intentionally NOT asserted byte-equal; two are in this routed cohort", nativeReferencesRetained: true },
    "b494-preimplementation": { sourceCommit: commits.broadSource, wholeGateQualified: false, optionParser: 'options(args, "iu:0C:", { "ignore-environment": "i", unset: "u", null: "0", chdir: "C" }, true)', missingS: true },
    "84ab-unchanged-canonical": { sourceCommit: commits.productSource, testCommit: commits.canonicalInputs, capture: replayPath, tests: 89, failures: 0, sourceFiles: Object.keys(replay.sourceInventory).filter(name => name.startsWith("src/")).length, testInputFiles: inputPaths.length, nativeRuns: 0 },
    "sealed-84ab-valid-v2-core": { commit: commits.independentVerdict, report: reviewTextPath, reportSha256: artifacts[reviewTextPath].sha256, disposition: postAudit.disposition, sourceCommit: postAudit.sourceCommit, fixtureCommit: postAudit.authorFixtureCommit, reviewerThread: postAudit.reviewerThreadId, authorThread: postAudit.authorThreadId },
  },
  authorEvidence: { capture: author + "core-validation.json", totalNodeTests: 90, unchangedCanonicalSubset: 89, selectedLegacy: 528, frozenPreparationUnchanged: authorValidation.frozenPreparationUnchanged, duringGuards: coreSeal.checks.duringCheckChangedGuards, laterConcurrentSourceDifferencesDisclosed: coreSeal.checks.committedSourceDifferences, qualification: "Author capture is not substituted for exact final-source qualification: its post-commit body.ts/jq.ts differences remain disclosed; this report's fresh89 replay uses entire committed84ab source" },
  independentEvidence: { sealed: true, commit: commits.independentVerdict, verdict: postAudit.disposition, rawPath: review + "acceptance-v2-1.json", rawSha256: postAudit.attempt.sha256, completed: independent.completed, productChildren: postAudit.guards.productProcesses, allChildProcesses: independent.summary.childProcesses, independentControls: independent.summary.independentControls, summary: independent.summary, canonical89DirectlyRunByThisReviewer: false, qualification: "Different frozen moved-package/core cohorts are corroboration, not a name-for-name89 replay or a broad-gate result. This leaf classification does not self-issue the independent verdict", retainedPrimaryProtocolLosses: postAudit.retainedHiddenPrimaryProtocolLosses, retainedPackedProtocolLosses: postAudit.retainedPackedProtocolLosses },
  proposal: { migrationCount: 0, mutablePaths: [], expectationChanges: [], productionChanges: [], action: "Retain canonical files/helpers/native expectations unchanged. ROOT may authorize a later authenticated gate; preserve this b494 diagnostic capture and its original307 failures", historicalArtifactPolicy: "No routed row is an old-source pin, hence B0. Raw b494/e7 observations remain immutable historical facts; reproducing those old outcomes requires their actual frozen source. Native captures retain their own complete tool/host/grammar profiles. A live test referencing immutable native expectations is not thereby a historical product pin", exclusions: ["89 historical diagnostic-driver pin rows (separate owner)", "10 historical cleanup-pin rows (Plato)", "foreign30/11 type diagnostics", "native prerequisite staging repairs", "env-S shebang/runtime feature expansion", "global gate or superiority claims"] },
  artifacts,
};
assert.ok(Object.values(summary.canonicalInputDiffs).every(value => value === ""));
const rowText = `{\n  "schema": "${summary.schema}",\n  "summary": "summary.json",\n  "rows": [\n${rows.map(row => "    " + JSON.stringify(row)).join(",\n")}\n  ]\n}\n`;
const outputs = { "rows.json": rowText, "summary.json": JSON.stringify(summary, null, 2) + "\n" };
for (const [name, content] of Object.entries(outputs)) {
  const destination = path.join(directory, name);
  if (fs.existsSync(destination)) assert.equal(fs.readFileSync(destination, "utf8"), content, `Generated evidence differs: ${name}`);
  else run("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${relative(name)}\n${content.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n` });
}
console.log(JSON.stringify({ counts, migrationPaths: [], independentVerdict: commits.independentVerdict, verifiedArtifacts: Object.keys(artifacts).length }));

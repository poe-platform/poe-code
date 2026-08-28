import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";

const root = "/Users/kjopek/Workspace/safe-bash";
const prefix = "tests/commands/yq-independent-20260828";
const directory = `${prefix}/final-carry-v1`;
const review = `${prefix}/final-carry-review-v1`;
const candidate = "bd471ef682d768692a682d40009a874f51e3ad68";
const predicateSeal = "c52a1d733576aebad79f154e71146923b5aa4e0c";
const preparationSeal = "cbc3ff0b8188f8cce88d91382ffc9c149606bcd6";
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 4194304 });
const text = (...args) => git(...args).toString().trim();
const pinned = (revision, file) => git("show", `${revision}:${file}`);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const json = (revision, file) => JSON.parse(pinned(revision, file));
const read = file => readFileSync(`${root}/${file}`);
const canonical = value => digest(JSON.stringify(value));
assert.equal(process.cwd(), root);
assert.equal(text("rev-parse", "--show-toplevel"), root);
const startHead = text("rev-parse", "HEAD");
const indexBefore = digest(git("diff", "--cached", "--binary", "--full-index"));
const predicates = json(predicateSeal, `${review}/PREDICATES.json`);
const baseline = json(preparationSeal, `${review}/PROTECTED_BASELINE.json`);
assert.equal(digest(pinned(predicateSeal, `${review}/PREDICATES.json`)), "ac3c96476bec0bd2a2a6a63facf8805a5d28b5e15454f67d8c94ac50ba135733");
assert.equal(digest(pinned(preparationSeal, `${review}/PROTECTED_BASELINE.json`)), "7d1ff3935e81304d6ba44f6174971c23c6b262a5dfca026711e0c262192b71a1");
const names = ["CONTRACT.md", "MANIFEST.json", "RESOURCE-TRACES.json", "SOURCES.json", "check.mjs"];
const candidatePaths = [`${prefix}/README.md`, ...names.map(name => `${directory}/${name}`)];
assert.deepEqual(text("diff-tree", "--no-commit-id", "--name-only", "-r", candidate).split("\n"), candidatePaths);
assert.equal(text("show", "-s", "--format=%P", candidate), "4b94b827fce7d7efc62a4ce52c5a69c1e4cae46a");
const delta = git("diff", "--no-ext-diff", "--binary", "--full-index", `${candidate}^`, candidate, "--", ...candidatePaths);
assert.equal(digest(delta), "5c2cca06c7b30d7ef2dd91764ca4b82d615fc68dc58e8cad53d9652baf44f908");
const suppliedHashes = {
  "CONTRACT.md": "1e31a9883fdaf3e8fbb890c736a4082246b58d6dafd7479ebbec194dd8531401",
  "MANIFEST.json": "98871d5f7f98e9a9b666310d7189c176bab895d84dd313b3da2cc017ed2fd26d",
  "SOURCES.json": "11eba6977e60c33340374ecb51b002f330d2ca97a3c59384991eeff24134b5c6",
};
for (const [name, hash] of Object.entries(suppliedHashes)) assert.equal(digest(pinned(candidate, `${directory}/${name}`)), hash);
const manifest = json(candidate, `${directory}/MANIFEST.json`);
const sources = json(candidate, `${directory}/SOURCES.json`);
const traces = json(candidate, `${directory}/RESOURCE-TRACES.json`);
const contract = pinned(candidate, `${directory}/CONTRACT.md`).toString();
assert.equal(digest(manifest.rootDecisionVerbatim), "138bc2fd25e3e9b83ccc63fdfd41f4f977e167e5a8e4cefb8281cf7a6e28b1a0");
assert.deepEqual(manifest.allowedCommitPaths, candidatePaths);
git("merge-base", "--is-ancestor", predicateSeal, candidate);
git("merge-base", "--is-ancestor", preparationSeal, candidate);

function identity(revision, file) {
  const bytes = pinned(revision, file);
  const [mode, kind, blob] = text("ls-tree", revision, "--", file).split("\t")[0].split(" ");
  assert.equal(kind, "blob", file);
  return { path: file, mode, blob, bytes: bytes.length, sha256: digest(bytes) };
}

function verifyLive(expected) {
  const metadata = lstatSync(`${root}/${expected.path}`);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), expected.path);
  assert.equal(metadata.mode & 0o111 ? "100755" : "100644", expected.mode, expected.path);
  const bytes = read(expected.path);
  assert.equal(bytes.length, expected.bytes, expected.path);
  assert.equal(digest(bytes), expected.sha256, expected.path);
  return expected;
}

function membership(scope) {
  const metadata = lstatSync(`${root}/${scope}`);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), scope);
  return [scope, ...readdirSync(`${root}/${scope}`, { withFileTypes: true }).flatMap(entry => {
    const file = `${scope}/${entry.name}`;
    assert(!entry.isSymbolicLink(), file);
    assert(entry.isFile() || entry.isDirectory(), file);
    return entry.isDirectory() ? membership(file) : [file];
  })];
}

const preparedNames = ["PROTOCOL.md", "PREDICATES.json", "PROTECTED_BASELINE.json", "check-literals.mjs", "PREPARATION-RESULT.json", "PREPARED.md"];
const preparedIdentities = preparedNames.map(name => identity(preparationSeal, `${review}/${name}`));
const candidateIdentities = candidatePaths.map(file => identity(candidate, file));
const historicalIdentities = baseline.members.map(member => ({ path: member.path, mode: member.mode, blob: member.gitBlob, bytes: member.bytes, sha256: member.sha256 }));
assert.equal(historicalIdentities.length, 50);
assert.equal(baseline.membership.length, 59);
assert.equal(baseline.scopes.length, 8);

function snapshot() {
  const members = baseline.scopes.flatMap(membership).sort();
  assert.deepEqual(members, baseline.membership);
  assert.deepEqual(membership(directory).filter(file => file !== directory).sort(), candidatePaths.filter(file => file.startsWith(`${directory}/`)));
  for (const entry of historicalIdentities) {
    assert.deepEqual(identity(baseline.revision, entry.path), entry);
    assert.deepEqual(identity(candidate, entry.path), entry);
    verifyLive(entry);
  }
  for (const entry of [...preparedIdentities, ...candidateIdentities]) verifyLive(entry);
  return {
    protectedFiles: 50, protectedScopes: 8, protectedMembershipEntries: members.length,
    historicalIdentitySha256: canonical(historicalIdentities), membershipSha256: canonical(members),
    preparedFiles: 6, preparedIdentitySha256: canonical(preparedIdentities),
    candidateFiles: 6, candidateIdentitySha256: canonical(candidateIdentities),
  };
}

const before = snapshot();
const sourceData = new Map();
const sourceIdentities = [];
for (const source of sources.sources) {
  assert(!sourceData.has(source.id));
  const actual = identity(source.revision, source.path);
  assert.deepEqual(actual, { path: source.path, mode: source.mode, blob: source.blob, bytes: source.bytes, sha256: source.sha256 });
  if (source.workingMatch) verifyLive(actual);
  sourceData.set(source.id, pinned(source.revision, source.path));
  sourceIdentities.push({ id: source.id, revision: source.revision, ...actual });
}
assert.equal(sourceIdentities.length, 28);
assert.deepEqual(sources.protectedScopes.map(scope => scope.path).sort(), [...baseline.scopes].sort());
for (const scope of sources.protectedScopes) {
  assert.equal(text("rev-parse", `${scope.revision}:${scope.path}`), scope.tree);
  assert.equal(digest(git("ls-tree", "-r", scope.revision, "--", scope.path)), scope.treeListingSha256);
  const actual = text("ls-tree", "-r", scope.revision, "--", scope.path).split("\n").map(line => {
    const [metadata, file] = line.split("\t");
    const [mode, , blob] = metadata.split(" ");
    return { path: file, mode, blob };
  });
  assert.equal(actual.length, scope.files);
  assert.deepEqual(actual, historicalIdentities.filter(entry => entry.path.startsWith(`${scope.path}/`)).map(({ path, mode, blob }) => ({ path, mode, blob })));
}
for (const artifact of manifest.artifactHashes) assert.equal(digest(pinned(candidate, `${directory}/${artifact.path}`)), artifact.sha256);
const sourceJson = id => JSON.parse(sourceData.get(id));
const final = sourceJson("final");
const fixed = sourceJson("freeze-fixed-values");
const adoption = sourceJson("adoption");
const prior = sourceJson("qb-review-cases");
assert.equal(digest(sourceData.get("qb-review-cases")), predicates.priorIndependent.casesSha256);
assert.equal(sources.revisions.final, predicates.acceptedReferences.finalContract);
assert.equal(sources.revisions.adoption, predicates.acceptedReferences.rootAdoption);
assert.equal(sources.revisions.n, predicates.acceptedReferences.adoptedNEncoder);
assert.equal(sources.revisions.nReview, predicates.acceptedReferences.independentNEncoder);
assert.equal(digest(sourceData.get("final")), predicates.acceptedReferences.finalContractJsonSha256);
assert.equal(digest(sourceData.get("qb-policy")), "96a7ae5aa36cec464a28d9ba09cfcd9791cb0dd09e80a51a6fc203cdd87b7ac6");
assert(sourceData.get("qb-policy").subarray(0, sourceData.get("qb-base").length).equals(sourceData.get("qb-base")));
const nResults = sourceJson("n-results");
assert.equal(digest(sourceData.get("n-results")), "7711c6833d9605e19bd2a2f1197f06798a8f2cafb4e269c7159795ff6f7535cc");
assert.equal(nResults.authorSummary.examined, 32);
assert.equal(nResults.authorSummary.tupleMismatches, 0);
assert.equal(nResults.mutationSummary.detected, 36);
assert.equal(nResults.mutationSummary.undetected, 0);
assert.deepEqual(nResults.unresolvedFixtureIssues, []);
assert.equal(adoption.diagnostics.reservedConflict.code, "ALIAS_DUPLICATE_ANCHOR");

function pointer(value, path) {
  for (const key of path.split("/").slice(1)) {
    assert(value !== null && typeof value === "object" && Object.hasOwn(value, key), path);
    value = value[key];
  }
  return value;
}

assert.equal(manifest.inheritedBindings.length, 14);
for (const binding of manifest.inheritedBindings) assert.equal(canonical(pointer(sourceJson(binding.source), binding.pointer)), binding.sha256);
assert.deepEqual(final.fixedPrivateCaps.values, fixed.caps);
assert.deepEqual(final.defaultBudgetMapping, fixed.budget);
assert.deepEqual(final.diagnostics.catalogue.map(row => [row.category, row.code, row.status]), fixed.diagnostics);
assert.equal(Object.keys(fixed.caps).length, 21);
assert.equal(Object.keys(fixed.budget).length, 9);
assert.equal(fixed.diagnostics.length, 54);
for (const name of ["help", "version"]) {
  const bytes = Buffer.from(final.exactInformation[name]);
  assert.equal(bytes.length, fixed.information[`${name}Utf8Bytes`]);
  assert.equal(digest(bytes), fixed.information[`${name}Sha256`]);
}
assert.equal(final.exactInformation.version, "virtual-bash restricted YAML profile\n");
assert.deepEqual(final.cliAmendments.informationForms, [[], ["eval"], ["e"]].flatMap(args => ["--help", "-h", "--version"].map(flag => [...args, flag])));

const allCases = new Map();
const coverage = [];
for (const group of manifest.coverage.groups) {
  const packet = sourceJson(group.source);
  assert.equal(packet.cases.length, group.records);
  assert.deepEqual(packet.cases.map(row => row.id), group.caseIds.split(" "));
  assert.equal(canonical(packet.cases.map(row => ({ id: row.id, input: row.input }))), group.originalInputsSha256);
  for (const row of packet.cases) {
    assert(!allCases.has(row.id));
    assert(row.input && row.expect);
    allCases.set(row.id, row);
  }
  coverage.push({ source: group.source, records: packet.cases.length, allOriginalRecordsSha256: canonical(packet.cases), originalInputsSha256: group.originalInputsSha256 });
}
assert.equal(allCases.size, predicates.history.originalRecords);
const overlayIds = ["ENC-07", "NUM-14", "NUM-15", "QUE-12", "UTF-12", "WRK-10", "WRK-22", "WRK-26"];
assert.deepEqual(manifest.overlays.map(row => row.id).sort(), overlayIds);
const overlays = new Map(manifest.overlays.map(row => [row.id, row]));
const nCases = new Map(sourceJson("n-cases").cases.map(row => [row.id, row]));
const expectedNBindings = { "NUM-14": "N2-05", "NUM-15": "N2-01", "UTF-12": "N3-02", "ENC-07": "E-01" };
for (const overlay of manifest.overlays) {
  const original = allCases.get(overlay.id);
  for (const field of overlay.fields) pointer(original, field);
  if (expectedNBindings[overlay.id]) {
    assert.equal(overlay.currentExpectation.caseId, expectedNBindings[overlay.id]);
    assert.deepEqual(overlay.fields, ["/blocked", "/expect"]);
    const accepted = nCases.get(expectedNBindings[overlay.id]);
    assert.equal(original.input.stdinUtf8, accepted.input.utf8);
    assert.deepEqual(pointer(accepted, overlay.currentExpectation.pointer), accepted.expect);
  }
  if (original.blocked) assert.equal(overlay.state, "RESOLVED");
}
for (const original of allCases.values()) if (original.blocked) assert(overlays.has(original.id));
assert.equal(nCases.get("E-01").expect.stdout.hex, "225c7530303030220a");
assert.equal(nCases.get("N2-01").expect.stdout.utf8, "1E-1147483646\n");
assert.equal(nCases.get("N3-02").expect.stdout.utf8, '"🙂"\n');
assert.deepEqual(overlays.get("QUE-12").fields, ["/blocked", "/note"]);
assert.equal(overlays.get("WRK-10").currentExpectation.pointer, "/resolved/1/currentBoundary");
pointer(sourceJson("reconciliation"), overlays.get("WRK-10").currentExpectation.pointer);
assert.deepEqual(manifest.coverage.policyHeldIds, []);
assert.equal(manifest.evidenceScope.uniqueProductCaseUnion, null);
assert.equal(manifest.evidenceScope.normative, 80);
assert.equal(manifest.evidenceScope.queryBudget, 62);
assert.equal(manifest.evidenceScope.authorArithmeticHistoricalRows, 23);
for (const key of ["historicalRecordsEdited", "historicalResultsRescored"]) assert.equal(manifest.evidenceScope[key], false);
for (const key of ["newYamlInputs", "policyHoldsRemaining", "productExecutions", "nativeOrParserExecutions", "lengthPackReplays"]) assert.equal(manifest.evidenceScope[key], 0);
assert.equal(manifest.futureModule.baseline, "5137a74ec855a32d8a8860eb66b62eb44d11e290");
assert.equal(manifest.futureModule.acceptedLength, "74361026502d76b8c2b696f9c60e410ac9b78d95");
assert.equal(manifest.futureModule.lengthPrerequisiteRemains, false);
assert.equal(manifest.futureModule.full846Accepted, true);
assert.equal(manifest.futureModule.implemented, false);
assert.equal(manifest.futureModule.globalGoGranted, false);
assert.deepEqual(manifest.actualContradictions, []);
const limitsPath = "src/commands/structured/limits.ts";
assert.deepEqual(pinned(manifest.futureModule.acceptedLength, limitsPath), sourceData.get("baseline-limits"));
assert.deepEqual(text("diff-tree", "--no-commit-id", "--name-only", "-r", manifest.futureModule.acceptedLength).split("\n"), ["src/commands/structured/interpreter.ts"]);

function exactPlan(pending, units) {
  if (!Number.isSafeInteger(pending) || pending < 0 || pending > 1023) return { error: "pending" };
  if (!Number.isSafeInteger(units) || units < 0) return { error: "units" };
  if (units === 0) return { checkpoints: 0, finalPending: pending, cost: 0 };
  const sum = BigInt(pending) + BigInt(units);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) return { error: "sum" };
  const checkpoints = (sum - 1n) / 1023n;
  const total = BigInt(units) + checkpoints;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return { error: "total" };
  return { checkpoints: Number(checkpoints), finalPending: Number(sum - checkpoints * 1023n), cost: Number(total) };
}

for (const [group, count] of Object.entries(predicates.priorIndependent.rowGroups)) {
  assert.equal(prior[group].length, count);
  assert.equal(traces.currentProjection[group].count, count);
}
assert.deepEqual(traces.currentProjection.scheduleRows.select, ["checkpoints", "finalPending", "cost"]);
assert.deepEqual(traces.currentProjection.scheduleRows.excludeFromCurrentPolicy, ["terminalCloseCost"]);
assert.equal(traces.currentProjection.admissionRows.select, "beforeNextAdmits");
assert.deepEqual(traces.currentProjection.admissionRows.excludeFromCurrentPolicy, ["terminalCloseAdmits"]);
const priorById = new Map(Object.keys(predicates.priorIndependent.rowGroups).flatMap(group => prior[group]).map(row => [row.id, row]));
assert.equal(priorById.size, 64);
for (const row of prior.scheduleRows) assert.deepEqual(exactPlan(row.pending, row.units), { checkpoints: row.checkpoints, finalPending: row.finalPending, cost: row.cost });
for (const row of prior.sequenceRows) {
  const estimate = exactPlan(row.pending, row.estimateUnits);
  const copy = exactPlan(estimate.finalPending, row.copyUnits);
  assert.deepEqual([estimate.cost, estimate.finalPending, copy.cost, copy.finalPending, estimate.cost + copy.cost], [row.estimateCost, row.postEstimatePending, row.copyCost, row.finalPending, row.combinedCost]);
}
for (const row of prior.admissionRows) assert.equal(priorById.get(row.schedule).cost <= row.remaining, row.beforeNextAdmits);
for (const row of prior.refusalRows) assert.deepEqual(exactPlan(row.pending, row.units), { error: row.stage });
for (const row of prior.payloadRows) assert.equal(row.operations.reduce((units, fragments) => units + Math.ceil(fragments.reduce((sum, bytes) => sum + bytes, 0) / 1024), 0), row.units);
for (const row of prior.mutationRows) assert.notEqual(row.expected ?? row.expectedUnsafeAdditions, row.mutant ?? row.mutantUnsafeAdditions);
for (const row of prior.traceRows) assert.equal(row.expect.refund, 0);

const compact = value => value.replace(/\s+/gu, " ");
const requiredClauses = [
  "check `U <= MAX_SAFE_INTEGER-c` before c+U", "`K <= MAX_SAFE_INTEGER-U` before U+K",
  "`finish`, phase/document end and empty close MUST NOT flush or reset it.",
  "If no owned unit follows, **no final tick is owed**.",
  "separately charge a bounded async estimator", "plan from **post-estimate c**",
  "call the one existing Budget.step(U+K) once", "before copy allocation",
  "directly awaits the signal-bound immediate", "it MUST NOT call real Budget.step/tick again",
  "No interleaved query/scanner/estimator/normal charge/nested reservation",
  "without refund or session reuse", "after EVERY await and BEFORE copy/allocation",
  "before publishing any copy/result", "uncharged signal/state checks",
  "no new tick, ordinary work unit, diagnostic, error identity, public option or outcome precedence",
  "Guard failures MUST NOT bypass finally or the admitted-work drain.",
  "observing the admission closure caused by normal close does not invent an execution error or stop cleanup",
  "if the borrowed signal is aborted, use its exact reason, including false/null/undefined or an object",
  "otherwise preserve the original immediate rejection", "Do not infer provenance from equality/truthiness.",
  "Existing compiler/interpreter-internal bounded synchronous phases and actual engine charges remain qualified and unchanged.",
  "new yq/private-adapter files only", "one compile, one Interpreter and one invocation Budget",
];

function validatePolicy(data) {
  const prose = compact(data.contract);
  for (const clause of requiredClauses) assert(prose.includes(clause), clause);
  const current = data.traces;
  assert.equal(current.guardModel.guardCharges, predicates.guards.chargedUnits);
  assert.equal(current.guardModel.afterAwaitRequired, true);
  assert.equal(current.guardModel.beforeAllocationRequired, true);
  assert.equal(current.guardModel.beforePublicationRequired, true);
  assert.equal(current.handoffs.length, 4);
  const handoffs = new Map(current.handoffs.map(row => [row.id, row]));
  assert.deepEqual(handoffs.get("C01").expect, { checkpoints: 0, cost: 1, admitted: true, finalPending: 1023, remaining: 0, finishCost: 0, nextReservationUnits: 1, nextReservationCost: 2, nextReservationAdmitted: false, nextCopyAllocated: false });
  assert.deepEqual(handoffs.get("C02").expect, { checkpoints: 0, cost: 0, admitted: true, finalPending: 1023, remaining: 0, finishCost: 0, phaseCloseCost: 0, emptyCloseCost: 0, terminalTickOwed: false });
  assert.deepEqual(handoffs.get("C03").expect.nextNormalUnit, { realCheckpointCost: 1, ordinaryCost: 1, finalPending: 1 });
  assert.equal(handoffs.get("C03").expect.finalPending, 1023);
  assert.deepEqual(handoffs.get("C04").expect, { estimateCost: 1023, postEstimatePending: 1023, copyCheckpoints: 1, copyCost: 2, combinedCost: 1025, finalPending: 1, finishCost: 0, reservationStepCalls: 1, copyRealStepCalls: 0, copyRealTickCalls: 0 });
  for (const handoff of current.handoffs) for (const id of handoff.lineage) assert(priorById.has(id));
  assert.equal(current.guardRows.length, 18);
  for (const row of current.guardRows) {
    assert(priorById.has(row.lineage));
    const outcome = row.aborted ? "caller" : row.executionFailure ? "execution" : row.yieldFailure ? "yield" : row.closed ? "closed" : row.cleanupFailure ? "cleanup" : "continue";
    const permitted = outcome === "continue";
    assert.deepEqual(row.expect, {
      outcome, charged: row.stage === "before-admission" && !permitted ? 0 : exactPlan(row.pending, row.units).cost,
      allocatedBeforeGuard: row.stage === "final-publication" ? row.units : 0,
      mayAllocate: permitted && row.allocationIntent, mayPublish: permitted && row.publishIntent,
      pendingReset: row.stage === "prepaid-await-fulfilled" && permitted, settled: row.drained, refund: 0,
    }, row.id);
  }
  assert.deepEqual(current.guardRows.slice(0, 4).map(row => row.reason), ["false", "null", "undefined", "object"]);
  assert.equal(current.guardRows.find(row => row.id === "G11").expect.outcome, "yield");
  assert.equal(current.guardRows.find(row => row.id === "G12").expect.outcome, "caller");
  assert.equal(current.guardRows.find(row => row.id === "G16").expect.settled, false);
}

const policy = { contract, traces };
validatePolicy(policy);
const mutations = [];
function rejectMutation(family, value, mutate, validate) {
  const mutant = structuredClone(value);
  mutate(mutant);
  let rejected = false;
  try { validate(mutant); } catch (error) { assert(error instanceof assert.AssertionError); rejected = true; }
  assert(rejected, family);
  mutations.push({ family, rejected, classification: "in-memory static predicate rejection, not runtime mutation" });
}
const families = predicates.negativeControls;
const mutatePolicy = (index, mutate) => rejectMutation(families[index], policy, mutate, validatePolicy);
mutatePolicy(0, data => { data.traces.handoffs[0].expect.finishCost = 1; });
mutatePolicy(1, data => { data.traces.handoffs[0].expect.finalPending = 0; });
mutatePolicy(2, data => { data.traces.handoffs[2].expect.nextNormalUnit.realCheckpointCost = 0; });
mutatePolicy(3, data => { data.traces.guardModel.beforeAllocationRequired = false; });
mutatePolicy(4, data => { data.traces.guardModel.afterAwaitRequired = false; });
mutatePolicy(5, data => { data.traces.guardModel.beforePublicationRequired = false; });
mutatePolicy(6, data => { data.traces.guardModel.guardCharges = 1; });
mutatePolicy(7, data => { data.traces.handoffs[3].expect.copyRealTickCalls = 1; });
mutatePolicy(8, data => { data.contract = data.contract.replace("one existing Budget.step(U+K)", "one replacement Budget.step(U+K)"); });
mutatePolicy(9, data => { data.contract = data.contract.replace("separately charge a bounded async estimator", "use a free bounded async estimator"); });
mutatePolicy(10, data => { data.contract = data.contract.replace("No interleaved query/scanner/estimator/normal charge/nested reservation", "An interleaved query/scanner/estimator/normal charge/nested reservation"); });
const validateHistory = value => assert.deepEqual(value, historicalIdentities);
rejectMutation(families[11], historicalIdentities, value => { value[0].sha256 = "0".repeat(64); }, validateHistory);
rejectMutation(families[12], historicalIdentities, value => { value[0].mode = "100755"; }, validateHistory);
rejectMutation(families[13], historicalIdentities, value => { value.pop(); }, validateHistory);
assert.deepEqual(mutations.map(row => row.family), families);

const historicalPaths = [
  `${prefix}/freeze/verify-preparation.mjs`, `${prefix}/normative/check-static.mjs`,
  `${prefix}/query-budget/check.mjs`, `${prefix}/reconciliation-v1/check.mjs`,
  `${prefix}/adopted-n-encoder-v1/check.mjs`, `${prefix}/adopted-n-encoder-review-v1/results-v1/check.mjs`,
  `${prefix}/qb-mechanism-review-v1/check.mjs`,
];
assert.deepEqual(manifest.staticValidationReceipt.historicalCheckers.map(row => row.path), historicalPaths);
for (const receipt of manifest.staticValidationReceipt.historicalCheckers) {
  const entry = historicalIdentities.find(row => row.path === receipt.path);
  assert(entry);
  assert.equal(entry.sha256, receipt.checkerSha256);
  verifyLive(entry);
}
verifyLive(historicalIdentities.find(row => row.path === `${prefix}/freeze/recipes.mjs`));
const topLevelPaths = [historicalPaths[5], historicalPaths[6], `${directory}/check.mjs`, `${review}/check-literals.mjs`];
const runs = [];
const nestedRuns = [];
for (const file of topLevelPaths) {
  const expected = [...historicalIdentities, ...candidateIdentities, ...preparedIdentities].find(row => row.path === file);
  verifyLive(expected);
  const run = spawnSync(process.execPath, [file], { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 2097152, env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" } });
  assert.ifError(run.error);
  assert.equal(run.status, 0, `${file}: ${run.stderr}`);
  assert.equal(run.signal, null);
  const output = JSON.parse(run.stdout);
  if (file === historicalPaths[5]) {
    assert.deepEqual(output.freshCheckerRuns.map(row => row.checker.path), historicalPaths.slice(0, 5));
    for (const nested of output.freshCheckerRuns) {
      assert.equal(nested.exitStatus, 0);
      const original = historicalIdentities.find(row => row.path === nested.checker.path);
      assert.equal(nested.checker.sha256, original.sha256);
      assert.equal(digest(nested.stdout), nested.stdoutSha256);
      nestedRuns.push({ path: nested.checker.path, checkerSha256: original.sha256, exitStatus: nested.exitStatus, stdoutSha256: nested.stdoutSha256, stderrSha256: digest(nested.stderr), historicalLabelsUnrescored: true });
    }
  }
  if (file === `${directory}/check.mjs`) {
    assert.equal(output.delta.commit, candidate);
    assert.equal(output.delta.sha256, digest(delta));
    assert.equal(output.originalIds, 194);
    assert.equal(output.policyHolds, 0);
  }
  runs.push({ path: file, checkerSha256: expected.sha256, exitStatus: run.status, stdoutSha256: digest(run.stdout), stderrSha256: digest(run.stderr), stdoutBytes: Buffer.byteLength(run.stdout), summary: file === historicalPaths[5] ? { state: output.state, nestedCheckers: 5, authorSummary: output.authorSummary, mutationSummary: output.mutationSummary, chronology: "unchanged historical pending-resource labels, not current policy holds" } : output });
  snapshot();
}
const after = snapshot();
assert.deepEqual(after, before);
const indexAfter = digest(git("diff", "--cached", "--binary", "--full-index"));
console.log(JSON.stringify({
  schema: "yq-final-carry-independent-results/1", date: "2026-08-28",
  status: "READY_AUTHOR_FACING_PRECODE_STATIC_ONLY", candidate,
  predicateSeal, preparationSeal, startHead, endHead: text("rev-parse", "HEAD"),
  priorWait: "Historical bounded preparation only; not a finding or current prerequisite",
  authentication: { parent: "4b94b827fce7d7efc62a4ce52c5a69c1e4cae46a", deltaSha256: digest(delta), deltaBytes: delta.length, rootDecisionSha256: manifest.rootDecisionSha256, candidateIdentities, preparedIdentities, selectedSourceIdentities: sourceIdentities, before, after },
  inherited: { pointerBindings: 14, privateCaps: 21, budgetFields: 9, diagnostics: 54, helpBytes: 501, versionBytes: 37, nAcceptedTuples: 32, nAcceptedStaticControls: 36, noNewNReview: true, lengthAndFull846: "accepted relay, no pack replay" },
  coverage: { originalRecords: 194, groups: coverage, overlays: overlayIds, heldCurrentIds: [], unchangedOriginalAssertionsOutsideOverlays: 186, normativeHistoricalRecords: 80, queryHistoricalRecords: 62, additiveUniqueCount: null },
  ownComparisons: { originalQbRecords: 64, originalQbSourceBindingsViaLiteralChecker: 20, arithmeticAndControlViews: 52, schedule: 16, sequence: 5, chosenAdmission: 8, overflowAndInvalid: 9, payload: 4, originalMutationViews: 10, historicalTraceSchemaViews: 12, guardProjections: 18, handoffProjections: 4, originalCloseColumnsUnchanged: true, author23Executed: false },
  mutations, mutationCount: mutations.length, undetectedMutations: 0,
  freshCheckerRuns: runs, nestedCheckerRuns: nestedRuns,
  executionCounts: { topLevelAuthenticatedCheckers: 4, nestedHistoricalCheckers: 5, distinctHistoricalCheckers: 7, authorChecker: 1, preparedLiteralChecker: 1, checkerInvocations: 9, independentResultChecker: 1 },
  checkerSafety: { inspected: "Builtins, read-only Git, bounded data arithmetic; nested Node only the five listed authenticated static checkers", soleLocalHelper: `${prefix}/freeze/recipes.mjs`, productModulesImported: false, historyWrites: false },
  reviewNotes: ["Initial delta comparison omitted --full-index; full-index serialization matches the authorized exact SHA. No candidate change or finding.", "Author disclosed ancestor-directory membership-filter preparation defect; final descendant-only inventory agrees independently with the earlier frozen baseline."],
  index: { before: indexBefore, after: indexAfter, changedDuringCheck: indexBefore !== indexAfter, writesByChecker: false },
  actualContradictions: [], unresolvedPolicyChoices: [],
  limitations: ["Static source/manifest/arithmetic/schema checks only; no runtime cancellation, scheduler, parser, Budget, VFS or encoder execution.", "Exact BigInt arithmetic is an independent bounded data comparator, not a product algorithm or runtime resource proof.", "14 controls mutate in-memory contract/trace/inventory data, not product code.", "Scoped before/after membership and Git modes detect added entries in selected subtrees, not a whole-repository or between-snapshot transaction guarantee.", "Historical 194/80/62/64/23 and accepted N outcomes remain immutable and unrescored; counts are not summed unique product tests.", "Existing synchronous compiler/interpreter internals remain qualified; future implementation and cleanup/public-API tests are still required."],
  productExecutions: 0, nativeExecutions: 0, runtimeCancellationTests: 0, buildOrTypeChecks: 0, dependenciesAdded: 0, privateCheckoutAccess: 0, productCodeGoOrRelease: false,
}, null, 2));

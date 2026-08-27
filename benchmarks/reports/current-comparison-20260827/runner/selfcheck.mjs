import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preflight, preparation, requiredRoles, schema, sha256, readCaps } from "./gate.mjs";
import { createReader } from "./reader.mjs";
import { auditLifecycle, expandedCaps, fallbackSchedule } from "./lifecycle-model.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../../..");
const jsonBytes = value => Buffer.from(`${JSON.stringify(value)}\n`);
const checks = [];

async function check(name, callback) {
  try {
    const detail = await callback();
    checks.push({ name, status: "PASS_MOCK_CHECK", ...(detail ? { detail } : {}) });
  } catch (error) {
    checks.push({ name, status: "FAIL_MOCK_CHECK", error: String(error.stack ?? error) });
  }
}

function mockManifest() {
  const roles = Object.fromEntries(requiredRoles.map(role => [role, role]));
  const identifiers = [...requiredRoles, "recipes224", "originalProfile", "alignedProfile", "originalOracle", "alignedOracle", "predicate224", "overlap", "breadthRecipes", "breadthProfile", "breadthExpected", "breadthPredicate", "holdoutRecipes", "holdoutProfile", "holdoutExpected", "holdoutPredicate"];
  for (const engine of ["virtual-bash", "just-bash"]) identifiers.push(...["entry", "packageManifest", "setup", "dispatchInventory", "resolutionReceipt", "lock"].map(field => `${engine}.${field}`));
  const artifacts = identifiers.map(id => {
    const bytes = jsonBytes({ mockOnly: true, id });
    return { id, path: `mock-only/${id}.json`, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const sourceTreeSha256 = "1".repeat(64);
  const packManifestSha256 = artifacts.find(artifact => artifact.id === "packManifest").sha256;
  return {
    schema, mode: "PREPARATION_ONLY", scope: "candidate-preparation", executionEnabled: false, timingEnabled: false,
    candidate: { commit: "2".repeat(40), sourceTreeSha256, state: "FUTURE_ROOT_FROZEN" },
    artifacts, roles, unionScore: null,
    reviews: Object.fromEntries(["inventoryReview", "packedReview"].map(role => [role, {
      artifact: role, reviewer: `MOCK-ONLY-${role}`, decision: "ACCEPT", sourceTreeSha256, packManifestSha256,
    }])),
    engines: ["virtual-bash", "just-bash"].map(id => ({
      id, version: id === "just-bash" ? "3.4.2" : "MOCK-NOT-A-CANDIDATE",
      ...Object.fromEntries(["entry", "packageManifest", "setup", "dispatchInventory", "resolutionReceipt"].map(field => [field, `${id}.${field}`])),
      locks: [`${id}.lock`],
    })),
    cohorts: [
      { id: "expanded-original-224", recipeCount: 224, diagnosticCount: 0, recipes: "recipes224", profile: "originalProfile", expectations: "originalOracle", predicate: "predicate224", overlapMap: "overlap" },
      { id: "expanded-aligned-224", recipeCount: 224, diagnosticCount: 0, recipes: "recipes224", profile: "alignedProfile", expectations: "alignedOracle", predicate: "predicate224", overlapMap: "overlap" },
      { id: "baseline-only", recipeCount: 61, diagnosticCount: 7, recipes: "breadthRecipes", profile: "breadthProfile", expectations: "breadthExpected", predicate: "breadthPredicate", overlapMap: "overlap" },
      { id: "new-tool-holdouts", recipeCount: 1, diagnosticCount: 0, recipes: "holdoutRecipes", profile: "holdoutProfile", expectations: "holdoutExpected", predicate: "holdoutPredicate", overlapMap: "overlap" },
    ],
  };
}

function receiptMock(manifest = mockManifest()) {
  const manifestBytes = jsonBytes(manifest);
  const rootReceiptBytes = jsonBytes({
    schema: "safe-bash.root-preparation-receipt.v1", authority: "ROOT",
    purpose: "PREPARATION_ONLY", manifestSha256: sha256(manifestBytes),
    executionAuthorized: false, timingAuthorized: false, fixture: "MOCK ONLY; NOT ROOT AUTHORITY",
  });
  return {
    manifestBytes, rootReceiptBytes, rootReceiptSha256: sha256(rootReceiptBytes),
    inspectArtifact: async artifact => ({ bytes: artifact.bytes, sha256: artifact.sha256, resolvedPath: `/MOCK-NOT-ON-DISK/${artifact.id}` }),
  };
}

function assertNoExecution(result) {
  assert.equal(result.executionEnabled, false);
  assert.equal(result.executorPresent, false);
  assert.equal(result.timingEnabled, false);
  assert.equal(result.score, null);
  for (const field of ["engineCalls", "nativeWorkloadCalls", "childProcessesCreated", "loopbackServersCreated", "performanceSamples"]) assert.equal(result[field], 0);
}

function historicalManifest(identifiers) {
  const manifest = mockManifest();
  manifest.scope = "historical-preparation";
  manifest.candidate = null;
  manifest.reviews = {};
  manifest.engines = [];
  manifest.roles = { cohortPlan: "cohortPlan", runnerSourceManifest: "runnerSourceManifest" };
  manifest.cohorts = manifest.cohorts.filter(cohort => identifiers.includes(cohort.id));
  for (const cohort of manifest.cohorts) if (cohort.id === "new-tool-holdouts") cohort.expectations = null;
  const selected = new Set(Object.values(manifest.roles));
  for (const cohort of manifest.cohorts) for (const field of ["recipes", "profile", "expectations", "predicate", "overlapMap"]) if (cohort[field] !== null) selected.add(cohort[field]);
  manifest.artifacts = manifest.artifacts.filter(artifact => selected.has(artifact.id));
  return manifest;
}

function sharedRoleManifest() {
  const manifest = mockManifest();
  const bytes = jsonBytes({ mockOnly: true, roles: Object.fromEntries(requiredRoles.map(role => [role, { kind: role }])) });
  const shared = { id: "sharedEvidence", path: "mock-only/shared.json", bytes: bytes.length, sha256: sha256(bytes) };
  manifest.artifacts = [shared, ...manifest.artifacts.filter(artifact => !requiredRoles.includes(artifact.id))];
  for (const role of requiredRoles) manifest.roles[role] = { artifact: shared.id, pointer: `/roles/${role}` };
  for (const role of ["inventoryReview", "packedReview"]) {
    manifest.reviews[role].artifact = manifest.roles[role];
    manifest.reviews[role].packManifestSha256 = shared.sha256;
  }
  return manifest;
}

for (const identifiers of [["expanded-original-224"], ["expanded-aligned-224"], ["baseline-only"], ["expanded-original-224", "expanded-aligned-224"]]) await check(`prepare selected historical cohorts only: ${identifiers.join(",")}`, async () => {
  const manifest = historicalManifest(identifiers);
  const result = await preflight(receiptMock(manifest));
  assert.equal(result.status, "PREPARED_EXECUTION_DISABLED");
  assert.deepEqual(result.selectedCohorts, identifiers);
  assert.deepEqual(result.uncapturedExpectations, []);
  assert.equal(result.artifactReceipts.length, manifest.artifacts.length);
  assert.ok(!manifest.artifacts.some(artifact => artifact.id.startsWith("holdout")));
  assertNoExecution(result);
});
await check("holdout proposal preserves null native expectations without inventing an oracle", async () => {
  const manifest = historicalManifest(["new-tool-holdouts"]);
  const result = await preflight(receiptMock(manifest));
  assert.equal(result.status, "PREPARED_EXECUTION_DISABLED");
  assert.deepEqual(result.uncapturedExpectations, ["new-tool-holdouts"]);
  assert.equal(manifest.cohorts[0].expectations, null);
  assert.ok(!manifest.artifacts.some(artifact => artifact.id === "holdoutExpected"));
  assertNoExecution(result);
});
await check("twelve evidence roles may share one document with distinct selectors", async () => {
  const result = await preflight(receiptMock(sharedRoleManifest()));
  assert.equal(result.status, "PREPARED_EXECUTION_DISABLED");
  assert.equal(result.artifactReceipts.filter(receipt => receipt.id === "sharedEvidence").length, 1);
  assertNoExecution(result);
});
for (const [name, mutate] of [
  ["shared role without selector", manifest => { manifest.roles.candidateFreeze = "sharedEvidence"; }],
  ["shared role with empty selector", manifest => { manifest.roles.candidateFreeze.pointer = ""; }],
  ["shared identical review selector", manifest => { manifest.roles.packedReview = manifest.roles.inventoryReview; }],
  ["shared document with same reviewer", manifest => { manifest.reviews.packedReview.reviewer = manifest.reviews.inventoryReview.reviewer; }],
  ["shared malformed selector", manifest => { manifest.roles.candidateFreeze.pointer = "/bad~selector"; }],
]) await check(`reject ${name}`, async () => {
  const manifest = sharedRoleManifest();
  mutate(manifest);
  const result = await preflight(receiptMock(manifest));
  assert.equal(result.status, "FAIL_PREFLIGHT");
  assertNoExecution(result);
  return result.reasons;
});
for (const [name, mutate] of [
  ["historical scope hiding candidate", manifest => { manifest.candidate = mockManifest().candidate; }],
  ["historical scope claiming candidate review", manifest => { manifest.reviews = mockManifest().reviews; }],
  ["historical original oracle removed", manifest => { manifest.cohorts[0].expectations = null; }],
  ["historical denominator shortened", manifest => { manifest.cohorts[0].recipeCount = 223; }],
  ["no selected cohort", manifest => { manifest.cohorts = []; }],
]) await check(`reject ${name}`, async () => {
  const manifest = historicalManifest(["expanded-original-224"]);
  mutate(manifest);
  const result = await preflight(receiptMock(manifest));
  assert.equal(result.status, "FAIL_PREFLIGHT");
  assertNoExecution(result);
});
await check("missing ROOT receipt on selected historical preparation stays WAITING_ROOT", async () => {
  const inputs = receiptMock(historicalManifest(["baseline-only"]));
  delete inputs.rootReceiptBytes;
  let reads = 0;
  inputs.inspectArtifact = async () => { reads++; throw new Error("must not read"); };
  const result = await preflight(inputs);
  assert.equal(result.status, "WAITING_ROOT");
  assert.equal(reads, 0);
  assertNoExecution(result);
});
await check("receipt size is bounded before hashing or parsing", async () => {
  const inputs = receiptMock();
  inputs.rootReceiptBytes = Buffer.alloc(readCaps.receiptBytes + 1);
  const result = await preflight(inputs);
  assert.equal(result.status, "FAIL_PREFLIGHT");
  assert.match(result.reasons[0], /receipt byte cap/u);
});
await check("reviewed v1 bytes and initial62 history remain intact as data", () => {
  const archive = JSON.parse(readFileSync(resolve(directory, "revisions/reviewed-v1/RECORD.json"), "utf8"));
  assert.equal(archive.reviewedSelfchecks.checks, 62);
  for (const record of archive.records) {
    const bytes = readFileSync(resolve(repository, record.archivedPath));
    assert.equal(bytes.length, record.bytes);
    assert.equal(sha256(bytes), record.sha256);
    if (record.reviewedSha256 !== null) assert.equal(record.reviewedSha256, record.sha256);
  }
});

await check("PREPARE is WAITING_ROOT, not a score", () => {
  const result = preparation();
  assert.equal(result.status, "WAITING_ROOT");
  assertNoExecution(result);
});
await check("absent ROOT receipt never calls artifact reader", async () => {
  let reads = 0;
  const result = await preflight({ inspectArtifact: async () => { reads++; throw new Error("must not read"); } });
  assert.equal(result.status, "WAITING_ROOT");
  assert.equal(reads, 0);
  assertNoExecution(result);
});
await check("missing candidate binding is WAITING_ROOT", async () => {
  const manifest = mockManifest();
  delete manifest.candidate;
  const result = await preflight(receiptMock(manifest));
  assert.equal(result.status, "WAITING_ROOT");
  assertNoExecution(result);
});
await check("preparation-only receipt without keys or comparison approval cannot execute", async () => {
  const result = await preflight(receiptMock());
  assert.equal(result.status, "PREPARED_EXECUTION_DISABLED");
  assert.equal(result.artifactReceipts.length, mockManifest().artifacts.length);
  assertNoExecution(result);
});

const manifestCounterchecks = [
  ["run flag", manifest => { manifest.executionEnabled = true; }],
  ["timing flag", manifest => { manifest.timingEnabled = true; }],
  ["unfrozen candidate", manifest => { manifest.candidate.state = "INTEGRATION_68_TO_70_PENDING"; }],
  ["floating commit", manifest => { manifest.candidate.commit = "HEAD"; }],
  ["missing packed review", manifest => { delete manifest.roles.packedReview; }],
  ["stale review subject", manifest => { manifest.reviews.inventoryReview.sourceTreeSha256 = "9".repeat(64); }],
  ["stale pack subject", manifest => { manifest.reviews.packedReview.packManifestSha256 = "9".repeat(64); }],
  ["same reviewer", manifest => { manifest.reviews.packedReview.reviewer = manifest.reviews.inventoryReview.reviewer; }],
  ["changed 224 count", manifest => { manifest.cohorts[0].recipeCount = 223; }],
  ["changed aligned recipes", manifest => { manifest.cohorts[1].recipes = "holdoutRecipes"; }],
  ["merged TMPDIR profile", manifest => { manifest.cohorts[1].profile = manifest.cohorts[0].profile; }],
  ["merged native capture", manifest => { manifest.cohorts[1].expectations = manifest.cohorts[0].expectations; }],
  ["relaxed aligned predicate", manifest => { manifest.cohorts[1].predicate = "holdoutPredicate"; }],
  ["removed historical diagnostic", manifest => { manifest.cohorts[2].diagnosticCount = 6; }],
  ["invented score union", manifest => { manifest.unionScore = { passes: 1 }; }],
  ["unbound resolved entry", manifest => { manifest.engines[0].entry = "unreviewed-entry"; }],
  ["missing lock hash", manifest => { manifest.engines[1].locks = []; }],
  ["different baseline version", manifest => { manifest.engines[1].version = "latest"; }],
  ["oversized declared artifact", manifest => { manifest.artifacts[0].bytes = readCaps.artifactBytes + 1; }],
  ["aggregate read cap", manifest => { for (const artifact of manifest.artifacts.slice(0, 5)) artifact.bytes = readCaps.artifactBytes; }],
  ["duplicate artifact", manifest => { manifest.artifacts.push(manifest.artifacts[0]); }],
];
for (const [name, mutate] of manifestCounterchecks) await check(`reject ${name}`, async () => {
  const manifest = mockManifest();
  mutate(manifest);
  const inputs = receiptMock(manifest);
  let reads = 0;
  inputs.inspectArtifact = async () => { reads++; throw new Error("must not read"); };
  const result = await preflight(inputs);
  assert.equal(result.status, "FAIL_PREFLIGHT");
  assert.equal(reads, 0);
  assertNoExecution(result);
  return result.reasons;
});

for (const field of ["rootReceiptSha256"]) await check(`reject wrong ${field}`, async () => {
  const inputs = receiptMock();
  inputs[field] = "0".repeat(64);
  const result = await preflight(inputs);
  assert.equal(result.status, "FAIL_PREFLIGHT");
  assertNoExecution(result);
  return result.reasons;
});
for (const [name, mutate] of [
  ["non-ROOT authority", receipt => { receipt.authority = "SELF"; }],
  ["execution authority", receipt => { receipt.executionAuthorized = true; }],
  ["timing authority", receipt => { receipt.timingAuthorized = true; }],
  ["wrong purpose", receipt => { receipt.purpose = "COMPARISON"; }],
]) await check(`reject receipt ${name}`, async () => {
  const inputs = receiptMock();
  const receipt = JSON.parse(inputs.rootReceiptBytes);
  mutate(receipt);
  inputs.rootReceiptBytes = jsonBytes(receipt);
  inputs.rootReceiptSha256 = sha256(inputs.rootReceiptBytes);
  let reads = 0;
  inputs.inspectArtifact = async () => { reads++; throw new Error("must not read"); };
  const result = await preflight(inputs);
  assert.equal(result.status, "FAIL_PREFLIGHT");
  assert.equal(reads, 0);
  assertNoExecution(result);
});
await check("reject preparation receipt reused for another manifest", async () => {
  const inputs = receiptMock();
  const manifest = JSON.parse(inputs.manifestBytes);
  manifest.candidate.commit = "3".repeat(40);
  inputs.manifestBytes = jsonBytes(manifest);
  const result = await preflight(inputs);
  assert.equal(result.status, "FAIL_PREFLIGHT");
  assert.match(result.reasons[0], /different manifest/u);
});
await check("retain partial receipts when artifact hash changes", async () => {
  const inputs = receiptMock();
  const inspect = inputs.inspectArtifact;
  let reads = 0;
  inputs.inspectArtifact = async artifact => ({ ...await inspect(artifact), ...(reads++ === 1 ? { sha256: "0".repeat(64) } : {}) });
  const result = await preflight(inputs);
  assert.equal(result.status, "FAIL_PREFLIGHT");
  assert.equal(result.artifactReceipts.length, 1);
});
await check("missing on-disk approved artifact stays WAITING_ROOT", async () => {
  const inputs = receiptMock();
  inputs.inspectArtifact = async () => { throw Object.assign(new Error("mock missing freeze"), { code: "ENOENT" }); };
  const result = await preflight(inputs);
  assert.equal(result.status, "WAITING_ROOT");
  assertNoExecution(result);
});
await check("reject canonical artifact alias", async () => {
  const inputs = receiptMock();
  const inspect = inputs.inspectArtifact;
  inputs.inspectArtifact = async artifact => ({ ...await inspect(artifact), resolvedPath: "/MOCK/same-file" });
  const result = await preflight(inputs);
  assert.equal(result.status, "FAIL_PREFLIGHT");
});
await check("sibling row selectors preserve separate profiles without copying files", async () => {
  const manifest = mockManifest();
  for (const [index, profile] of ["original", "aligned"].entries()) {
    manifest.cohorts[index].recipes = { artifact: "recipes224", pointer: "", rowField: "recipe" };
    manifest.cohorts[index].profile = { artifact: "originalProfile", pointer: `/${profile}` };
    manifest.cohorts[index].expectations = { artifact: "recipes224", pointer: "", rowField: `${profile}Oracle` };
  }
  const result = await preflight(receiptMock(manifest));
  assert.equal(result.status, "PREPARED_EXECUTION_DISABLED");
  assertNoExecution(result);
});
await check("reader hashes executable-looking fixture without importing", () => {
  const filename = resolve(directory, "mock-not-an-engine.mjs.data");
  const bytes = readFileSync(filename);
  const receipt = createReader(repository).inspectArtifact({ path: filename, bytes: bytes.length });
  assert.equal(receipt.sha256, sha256(bytes));
});
await check("reader rejects directories, traversal and excess input", () => {
  const reader = createReader(repository);
  assert.throws(() => reader.readJsonInput(directory, 1024), /regular/u);
  assert.throws(() => reader.readJsonInput("../AGENTS.md", 1024), /Unsafe/u);
  assert.throws(() => reader.readJsonInput(resolve(directory, "mock-not-an-engine.mjs.data"), 1), /cap/u);
});

function cleanTranscript() {
  return [
    { type: "launch", atMs: 0 }, { type: "ready", atMs: 1 }, { type: "request-start", atMs: 2 },
    { type: "exec-start", atMs: 3 },
    { type: "guest-result", atMs: 4, observationComplete: true, assertionsMatch: true, outputBytes: 2, snapshotBytes: 3, diagnosticBytes: 0, reportBytes: 64 },
    { type: "exec-settled", atMs: 5 }, { type: "snapshot-complete", atMs: 6 },
    { type: "dispose-start", atMs: 6 }, { type: "dispose-settled", atMs: 7 },
    { type: "ipc-disconnected", atMs: 8 }, { type: "child-exit", atMs: 9, code: 0, signal: null, forced: false },
    { type: "stdio-close", atMs: 10 },
    { type: "resource-census", atMs: 11, complete: true, children: 0, workers: 0, sockets: 0, unsettledPromises: 0 },
  ];
}

await check("complete lifecycle is MODEL_CLEAN, not real process proof", () => {
  const result = auditLifecycle(cleanTranscript());
  assert.equal(result.status, "MODEL_CLEAN");
  assert.equal(result.realProcessEvidence, false);
});
const lifecycleCounterchecks = [
  ["stalled guest", events => events.splice(4)],
  ["unsettled execution", events => events.splice(5, 1)],
  ["stalled disposal", events => events.splice(8, 1)],
  ["exit without stdio close", events => events.splice(11, 1)],
  ["leaked worker after successful guest", events => { events.at(-1).workers = 1; }],
  ["unknown resource census", events => { events.at(-1).complete = false; }],
  ["late promise after close", events => { events.push({ type: "late-promise", atMs: 12 }); }],
  ["cancelled then successful", events => { events.splice(4, 0, { type: "cancel", atMs: 3 }); }],
  ["TERM then natural-looking exit", events => { events.splice(10, 0, { type: "term", atMs: 8 }); }],
  ["KILL then natural-looking exit", events => { events.splice(10, 0, { type: "kill", atMs: 8 }); }],
  ["partial stdout overflow", events => { events[4].outputBytes = expandedCaps.maxOutputBytes + 1; }],
  ["snapshot overflow", events => { events[4].snapshotBytes = expandedCaps.maxSnapshotBytes + 1; }],
  ["diagnostic overflow", events => { events[4].diagnosticBytes = expandedCaps.maxDiagnosticBytes + 1; }],
  ["IPC/report overflow", events => { events[4].reportBytes = expandedCaps.maxReportBytes + 1; }],
  ["duplicate result", events => { events.splice(5, 0, { ...events[4] }); }],
  ["guest deadline", events => { for (const event of events.slice(4)) event.atMs += 5001; }],
  ["setup consumes request deadline", events => { for (const event of events.slice(3)) event.atMs += 10001; }],
  ["startup deadline", events => { for (const event of events.slice(1)) event.atMs += 15001; }],
  ["settlement deadline", events => { for (const event of events.slice(5)) event.atMs += 1001; }],
  ["snapshot deadline", events => { for (const event of events.slice(6)) event.atMs += 1001; }],
  ["dispose deadline", events => { for (const event of events.slice(8)) event.atMs += 1001; }],
  ["natural-close deadline", events => { for (const event of events.slice(9)) event.atMs += 1001; }],
  ["parent watchdog", events => { events.push({ type: "watchdog-expired", atMs: 28000 }); }],
  ["reversed clock", events => { events[2].atMs = 0; }],
];
for (const [name, mutate] of lifecycleCounterchecks) await check(`model rejects ${name}`, () => {
  const events = cleanTranscript();
  mutate(events);
  const result = auditLifecycle(events);
  assert.equal(result.status, "MODEL_FAIL");
  return result.failures;
});
await check("TERM/KILL/stop-wait fallback never exceeds fixed parent cap", () => {
  for (const failureAtMs of [0, 5000, 26000, 27999, 28000, 50000]) {
    const schedule = fallbackSchedule(failureAtMs);
    assert.ok(schedule.termAtMs <= schedule.killAtMs && schedule.killAtMs <= schedule.stopWaitingAtMs);
    assert.ok(schedule.stopWaitingAtMs <= expandedCaps.parentTotalMs);
    assert.equal(schedule.watchdogAlreadyExpired, failureAtMs > expandedCaps.parentTotalMs);
    assert.equal(schedule.outcomeAfterFallback, "FAIL_NOT_CLEANED_PASS");
    assert.equal(schedule.realSignalsSent, 0);
  }
});
await check("runtime module graph contains only reviewed local files and builtins", () => {
  const files = ["prepare.mjs", "gate.mjs", "reader.mjs", "lifecycle-model.mjs", "selfcheck.mjs"];
  const allowed = new Set(["node:assert/strict", "node:crypto", "node:fs", "node:path", "node:url", "./gate.mjs", "./reader.mjs", "./lifecycle-model.mjs"]);
  for (const file of files) {
    const source = readFileSync(resolve(directory, file), "utf8");
    for (const match of source.matchAll(/^import .* from "([^"]+)";/gmu)) assert.ok(allowed.has(match[1]), `${file}: ${match[1]}`);
    if (file !== "selfcheck.mjs") {
      assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(|child_process|worker_threads|node:net|node:http|\beval\s*\(|\bFunction\s*\(/u);
      assert.doesNotMatch(source, /process\.(?:env|kill|exit|binding)\s*[.([]/u);
    }
  }
});

const failed = checks.filter(result => result.status === "FAIL_MOCK_CHECK");
console.log(JSON.stringify({
  mode: "PURE_MOCK_SELFCHECK", status: failed.length ? "FAIL_MOCK_CHECKS" : "PASS_MOCK_CHECKS",
  counts: { checks: checks.length, passed: checks.length - failed.length, failed: failed.length },
  fixtureAuthority: "Synthetic preparation coordination receipt and hashes only; not ROOT authority, execution approval or a candidate freeze.",
  engineCalls: 0, nativeWorkloadCalls: 0, childProcessesCreated: 0, loopbackServersCreated: 0,
  performanceSamples: 0, score: null, realLifecycleValidation: "NOT_RUN", checks,
}, null, 2));
process.exitCode = failed.length ? 1 : 0;

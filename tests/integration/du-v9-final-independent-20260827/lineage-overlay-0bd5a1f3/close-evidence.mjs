import assert from "node:assert/strict";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { owned, repository, freeze, candidate, overlayCommit, hash, json, save, inventory, sort, record } from "./common.mjs";
import { validateInventory, overlayReceipt } from "./adapter-support.mjs";

const read = async path => JSON.parse(await readFile(path));
const pre = await read(join(owned, "PRE.json"));
const replay = join(owned, "replay-once");
const runNames = (await readdir(replay)).filter(name => name.startsWith("run-"));
assert.equal(runNames.length, 1);
const evidence = join(replay, runNames[0]);
const document = name => read(join(evidence, name));
const history = await document("all-processes-raw/INDEX.json");
const bootstrapHistory = await read(join(replay, "bootstrap-processes/INDEX.json"));
const outer = await read(join(owned, "replay-SETTLED.json"));
const focused = await read(join(owned, "controls-SETTLED.json"));
const native = await document("native-environment-table.json");
const originalSource = await document("source-original.stdout");
const originalMoved = await document("package-original.stdout");
const freshSource = await document("source-v5.stdout");
const freshMoved = await document("package-v5.stdout");
const sourceAndMovedProjectionIdentical = JSON.stringify(freshSource.parityProjection) === JSON.stringify(freshMoved.parityProjection);
assert(sourceAndMovedProjectionIdentical);
const scratch = (await document("FAILED-CLOSURE.json")).scratchRetained;
const bootstrapScratch = (await read(join(replay, "BOOTSTRAP-PROCESS-CLOSURE.json"))).retainedScratch;
const materialized = join(bootstrapScratch, "extracted", pre.base.root);
validateInventory(await inventory(materialized), "overlay");
const source = join(scratch, "source");
const sourceFiles = await inventory(source);
assert.deepEqual(sourceFiles.filter(entry => !entry.path.startsWith("dist/")), pre.candidateRecords);
await save("CANDIDATE-POST-FAILURE.json", { exactInventoryIncludingNewEntries: true, records: pre.candidateRecords });
const runtime = await document("consumer-runtime.stdout");
const packed = await document("packed-files.json");
const installed = await inventory(runtime.packageRoot);
const minimal = entry => ({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 });
assert.deepEqual(installed.map(minimal), packed);
assert.deepEqual(await document("installed-files.json"), packed);
const pack = (await document("npm-pack.stdout"))[0];
const tarballPath = join(scratch, pack.filename);
const tarballSha256 = hash(await readFile(tarballPath));
const admission = await document("dependency-archive-pre-install-admission.json");
assert.equal(admission.admittedArchives[0].sha256, tarballSha256);
const loads = await document("next-load-attestation.json");
assert(loads.everySourceByteHashMatchesDisk);
for (const loaded of loads.records) {
  assert(loaded.path.startsWith(`${runtime.packageRoot}/dist/`));
  assert.equal(loaded.sourceSha256, hash(await readFile(loaded.path)));
  const packedFile = packed.find(entry => entry.path === relative(runtime.packageRoot, loaded.path));
  assert.equal(loaded.sourceSha256, packedFile.sha256);
}
for (const required of ["dist/commands/du/index.js", "dist/fs/overlay/index.js", "dist/fs/real/index.js"]) assert(loads.records.some(entry => entry.path === join(runtime.packageRoot, required)));
const loadBinding = { actualNextLoadRecords: loads.records.length, uniqueModules: new Set(loads.records.map(entry => entry.path)).size, allMatchAdmittedPackedAndInstalledBytes: true, records: loads.records, qualification: "Actual moved-installed nextLoad returned source bytes; source loadedFiles receipts are separately identified disk hashes, not substituted load proof." };
await save("LOAD-PACK-BINDINGS.json", { ...overlayReceipt("post-replay"), packageFiles: packed.length, tarballSha256, packRecord: pack, dependencyAdmission: admission, sourceCandidateArchiveSha256: hash(await readFile(join(scratch, "candidate.tar"))), loads: loadBinding, runtime });

const records = [...bootstrapHistory.records, ...history.records, outer.result];
function absent(target) {
  try { process.kill(target, 0); return false; }
  catch (error) { if (error.code === "ESRCH") return true; throw error; }
}
const processChecks = [];
for (const entry of records) {
  assert(entry.closure.rootPidGone && entry.closure.groupGone);
  assert(absent(entry.pid) && absent(-entry.pgid));
  processChecks.push({ pid: entry.pid, pgid: entry.pgid, rootAbsent: true, groupAbsent: true });
}
for (const pid of native.processClosure.spawnedRootPids) {
  assert(absent(pid) && absent(-pid));
  processChecks.push({ pid, pgid: pid, rootAbsent: true, groupAbsent: true });
}
assert.equal(new Set(processChecks.map(entry => entry.pid)).size, processChecks.length);
const timeoutControl = await document("process-timeout-grandchild-closure.json");
assert(absent(timeoutControl.grandchildPid));
assert(absent(focused.result.pid) && absent(-focused.result.pgid));
const terminated = records.filter(entry => entry.timedOut || entry.termination.termSent || entry.termination.killSent || entry.closure.descendantGroupDetected);
assert.equal(terminated.length, 1);
assert.equal(terminated[0].pid, timeoutControl.rootPid);
assert(native.records.every(entry => !entry.observed.timedOut && !entry.observed.closure.descendantGroupDetected));
const nativeProcess = history.records.find(entry => entry.command === process.execPath && entry.args[0]?.endsWith("/native-env.mjs"));
assert.equal(nativeProcess.status, 1);
await save("NATIVE-PROCESS.json", nativeProcess);

function metadata(receipt) {
  const cases = receipt.results.slice(0, 19);
  const deltas = cases.flatMap(entry => entry.observation.statDeltas);
  for (const entry of cases) for (const delta of entry.observation.statDeltas) {
    assert.equal(delta.type, "directory");
    assert.equal(delta.field, "atimeMs");
    assert(entry.observation.actionCalls.some(call => call.layer === delta.layer && call.method === "readdir" && call.path === delta.path));
  }
  return { total: cases.length, passed: cases.filter(entry => entry.pass).length, authorizedDirectoryAtimeDeltas: deltas.length, unauthorizedDeltas: cases.reduce((sum, entry) => sum + entry.observation.unauthorizedStatDeltas.length, 0), explicitMutationCalls: cases.reduce((sum, entry) => sum + entry.observation.mutations.length, 0), contentReadCalls: cases.reduce((sum, entry) => sum + entry.observation.content.length, 0) };
}
const environment = receipt => receipt.results.find(entry => entry.id === "V5-032").observation.table.map(({ id, pass }) => ({ id, pass }));
const regressionText = await readFile(join(evidence, "scoped-regressions.stdout"), "utf8");
const regressions = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(regressionText)?.[1])]));
assert.equal(regressions.tests, 128);
assert.equal(regressions.pass, 128);
const stepNames = ["build", "source-original", "source-v5", "scoped-regressions", "npm-pack-dry-run", "npm-pack", "npm-extract", "consumer-install", "consumer-strict-types", "consumer-runtime", "package-original", "package-v5", "negative-wrong-root", "negative-missing-du", "negative-restored-cleanup-v5", "negative-semantic-declaration"];
const steps = await Promise.all(stepNames.map(async name => ({ name, ...await document(`${name}.json`) })));
const mismatchRows = native.records.filter(entry => entry.classification.endsWith("mismatch"));
assert.equal(mismatchRows.length, 3);
assert(mismatchRows.every(entry => entry.observed.status === 1 && entry.observed.stdout === "" && entry.observed.stderr === "du: invalid -B argument 'invalid-value'\n"));
const removedMutants = [];
for (const name of ["negative-missing-du", "negative-restored-cleanup", "negative-semantic-declaration"]) {
  await assert.rejects(stat(join(scratch, name)), error => error.code === "ENOENT");
  removedMutants.push({ name, actualPostCleanupStat: "ENOENT" });
}
await save("COUNTS.json", {
  verdict: "BLOCKED_NATIVE_DIAGNOSTIC_MATCHER", staticOverlayAccepted: true, exactlyOneActualReplay: true,
  freeze, candidate, overlayCommit, binding: overlayReceipt("final-counts"), originalSource: originalSource.summary, originalMoved: originalMoved.summary,
  freshSource: freshSource.summary, freshMoved: freshMoved.summary, sourceAndMovedProjectionIdentical,
  metadataSource: metadata(freshSource), metadataMoved: metadata(freshMoved), environmentSource: environment(freshSource), environmentMoved: environment(freshMoved),
  correctedTimestampControls: { source: freshSource.results.slice(22,24), moved: freshMoved.results.slice(22,24) },
  regressions, pack: { files: packed.length, tarballSha256, movedInstalledInventoryExactlyMatchesPacked: true }, actualNextLoad: { records: loads.records.length, uniqueModules: loadBinding.uniqueModules, requiredDuOverlayRealLoaded: true, everyLoadedHashMatchesPackedAndInstalled: true },
  native: { ...native.summary, scope: native.scope, oracle: native.oracle, mismatchRows },
  blocker: { kind: "frozen native diagnostic classifier", source: `${pre.base.root}/native-env.mjs:71`, matcher: "/invalid.*block|block.*invalid/iu", actualDiagnostic: "du: invalid -B argument 'invalid-value'", failureExitPreserved: true, rawNativeTableRescored: false, establishedProductBug: false },
  intentionalControls: { focused: 15, adapterAdmissionNegatives: 5, originalMutantsPerMode: 3, freshMutantsPerMode: 7, processTimeout: timeoutControl, installedNegativeStatuses: steps.filter(entry => entry.name.startsWith("negative-")).map(({name,status}) => ({name,status})), admission: await read(join(replay, "bootstrap.json")), invalidPacklist: await document("npm-packlist-pre-archive-admission.json") },
  phases: { requestedSemanticPhasesAllExecuted: true, semanticPhasesUnexecuted: [], originalSuccessTailUnexecuted: ["post-native candidate-inputs-after write", "success-path source/index comparisons", "aggregate RESULTS.json", "automatic success cleanup receipts"], qualification: "Independent post-failure verification and cleanup are recorded separately; they do not rescore native or claim the original success tail ran." },
  steps, naturalClosure: { replayRootAndGroupCount: processChecks.length, bootstrap: bootstrapHistory.records.length, materialized: history.records.length, outer: 1, nativeVersionAndCases: native.processClosure.spawnedRootPids.length, everyActualCaseSettledNaturally: true, onlyTerminatedGroupWasIntentionalTimeout: true, focusedControlRootClosedSeparately: true, timeoutGrandchildAbsent: true, processChecks, removedMutants },
  scope: { publicDefaultDu: false, wholeGate: false, broadNativeParity: false, O060: "deferred/profile gap/deterministic ordering", v2ToV3Delta: "permanently unproved", originalV9: "40 markers / exit 1 remains rejected; not rescored" }, evidenceDirectory: relative(owned, evidence)
});

const roots = [bootstrapScratch, scratch, join(owned, "temporary")];
const retained = [];
for (const root of roots) {
  assert(root.startsWith(`${owned}/`));
  for (const entry of await inventory(root)) {
    assert(!/(^|\/)AGENTS\.md$/u.test(entry.path));
    retained.push({ ...entry, path: `${relative(owned, root)}/${entry.path}` });
  }
}
const expected = sort(retained);
await save("SCRATCH-INVENTORY.json", expected);
const archive = join(owned, "scratch.ndjson.gz.data");
async function* contents() {
  for (const entry of expected) {
    const bytes = await readFile(join(owned, entry.path));
    assert.deepEqual(record(entry.path, bytes), entry);
    yield `${JSON.stringify({ ...entry, base64: bytes.toString("base64") })}\n`;
  }
}
await pipeline(contents(), createGzip(), createWriteStream(archive, { flags: "wx" }));
const verified = [];
for await (const line of createInterface({ input: createReadStream(archive).pipe(createGunzip()), crlfDelay: Infinity })) {
  const { base64, ...entry } = JSON.parse(line);
  assert.deepEqual(record(entry.path, Buffer.from(base64, "base64")), entry);
  verified.push(entry);
}
assert.deepEqual(verified, expected);
const removed = [];
for (const root of roots) {
  await rm(root, { recursive: true });
  await assert.rejects(stat(root), error => error.code === "ENOENT");
  removed.push({ path: root, actualPostCleanupStat: "ENOENT" });
}
const remaining = await inventory(owned);
assert(!remaining.some(entry => /\.(?:ts|mts)$/u.test(entry.path) || /(^|\/)AGENTS\.md$/u.test(entry.path)));
await save("CLEANUP.json", { allReplayRootAndGroupsGone: processChecks.length, grandchildGone: true, actualCasesSettledNaturally: true, removed, archive: { path: relative(owned, archive), ...record(relative(owned, archive), await readFile(archive)), regularFiles: expected.length, everyPayloadReverified: true, format: "gzip-compressed NDJSON; one record per file with relative path, byte count, SHA-256, Git blob and base64 bytes" }, looseTsMtsOrAgents: 0 });
process.stdout.write(json({ verdict: "BLOCKED_NATIVE_DIAGNOSTIC_MATCHER", originalSource: originalSource.summary.passed, originalMoved: originalMoved.summary.passed, freshSource: freshSource.summary.passed, freshMoved: freshMoved.summary.passed, sourceMetadata: metadata(freshSource), movedMetadata: metadata(freshMoved), regressions, native: native.summary, loadedRecords: loads.records.length, packedFiles: packed.length, replayRootsAndGroupsClosed: processChecks.length, scratchFilesArchived: expected.length, scratchRootsRemoved: roots.length }));

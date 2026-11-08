import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const pre = JSON.parse(await readFile(join(owned, "PRE.json")));
const replay = join(owned, "replay-once");
const frozenRoot = join(pre.repository, pre.v9.path);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const save = (name, value) => writeFile(join(owned, name), Buffer.isBuffer(value) ? value : json(value), { flag: "wx" });
const readJson = async path => JSON.parse(await readFile(path));
const runNames = (await readdir(replay)).filter(name => name.startsWith("run-"));
assert.equal(runNames.length, 1);
const evidence = join(replay, runNames[0]);
const history = await readJson(join(evidence, "all-processes-raw/INDEX.json"));
const bootstrapHistory = await readJson(join(replay, "bootstrap-processes/INDEX.json"));
const settled = await readJson(join(owned, "ONE-REPLAY-SETTLED.json"));
const failed = await readJson(join(evidence, "FAILED-CLOSURE.json"));
const bootstrapClosure = await readJson(join(replay, "BOOTSTRAP-PROCESS-CLOSURE.json"));
const timeoutClosure = await readJson(join(evidence, "process-timeout-grandchild-closure.json"));
const bootstrap = await readJson(join(replay, "bootstrap.json"));
const original = await readJson(join(evidence, "source-original.stdout"));
const freshProcess = history.records.find(record => record.command === pre.tools.node.path && record.args[0]?.endsWith("/harness/verify-v5.mjs"));
assert(freshProcess && freshProcess.status === 1 && !freshProcess.timedOut);
const stem = String(freshProcess.sequence).padStart(3, "0");
const freshStdout = await readFile(join(evidence, `all-processes-raw/${stem}.stdout`));
const freshStderr = await readFile(join(evidence, `all-processes-raw/${stem}.stderr`));
assert.equal(freshStdout.length, 0);
assert.equal(hash(freshStderr), freshProcess.stderrSha256);
await save("fresh-source.stdout.data", freshStdout);
await save("fresh-source.stderr.data", freshStderr);
const names = freshStderr.toString().split("\n").filter(line => line.startsWith("ok - ")).map(line => line.slice(5));
const notOk = freshStderr.toString().split("\n").filter(line => line.startsWith("not ok - "));
assert.equal(names.length, 40);
assert.equal(notOk.length, 0);
const lineage = name => name.startsWith("consumer-registered pending cleanup") || name.startsWith("actual Shell lifecycle")
  ? "postfreeze-lifecycle-addition"
  : name.startsWith("real ") || name.startsWith("observer-only file read") || name.startsWith("atime field scope")
    ? "v5-observer-policy-control" : "historical-frozen-derived";
const byLineage = {};
for (const name of names) byLineage[lineage(name)] = (byLineage[lineage(name)] ?? 0) + 1;
assert.deepEqual(byLineage, { "historical-frozen-derived": 32, "v5-observer-policy-control": 6, "postfreeze-lifecycle-addition": 2 });
assert.match(freshStderr.toString(), /32 !== 31/u);

const processRecords = [...bootstrapHistory.records, ...history.records, settled.result];
const processChecks = [];
function absent(target) {
  try { process.kill(target, 0); return false; }
  catch (error) { if (error.code === "ESRCH") return true; throw error; }
}
for (const record of processRecords) {
  assert(record.closure.rootPidGone && record.closure.groupGone);
  const check = { pid: record.pid, pgid: record.pgid, rootAbsentNow: absent(record.pid), groupAbsentNow: absent(-record.pgid) };
  assert(check.rootAbsentNow && check.groupAbsentNow);
  processChecks.push(check);
}
assert(absent(timeoutClosure.grandchildPid));
assert.equal(new Set(processChecks.map(record => record.pid)).size, processChecks.length);

async function inventory(root) {
  const records = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      assert.notEqual(entry.name, "AGENTS.md");
      if (entry.isDirectory()) await visit(path);
      else {
        assert(entry.isFile(), `unsupported scratch entry ${path}`);
        const bytes = await readFile(path);
        records.push({ path: relative(root, path), bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  await visit(root);
  return records.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
const scratch = failed.scratchRetained;
assert(scratch.startsWith(`${replay}/work-`));
assert.equal(bootstrapClosure.retainedScratch, join(replay, "bootstrap-scratch"));
const source = join(scratch, "source");
const sourceInventory = await inventory(source);
const candidateAfter = sourceInventory.filter(record => !record.path.startsWith("dist/"));
const expectedCandidate = pre.candidate.records.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
assert.deepEqual(candidateAfter, expectedCandidate);
assert.deepEqual(await readJson(join(evidence, "candidate-inputs-before.json")), expectedCandidate);
await save("candidate-inputs-after.json", candidateAfter);
const materializedRoot = join(bootstrapClosure.retainedScratch, "extracted", pre.v9.path);
const materialized = await inventory(materializedRoot);
assert.deepEqual(materialized, pre.v9.records.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })));
await save("materialized-frozen-before-archival.json", { count: materialized.length, exactInventoryNoNewEntries: true, records: materialized });
const modules = ["fs/memory/index.js", "fs/overlay/index.js", "fs/readonly/index.js", "fs/mount/index.js", "fs/real/index.js", "commands/du/index.js", "contracts/index.js", "shell/index.js"].map(path => sourceInventory.find(record => record.path === `dist/${path}`));
assert(modules.every(Boolean));
await save("source-built-module-disk-identities.json", { qualification: "Post-settlement built files in the exact archived candidate root; not nextLoad attestation. Fresh verifier computed loadedFiles before its fatal summary assertion but never emitted that JSON.", modules });

const retainedRoots = [bootstrapClosure.retainedScratch, scratch, join(owned, "temporary")];
const retained = [];
for (const root of retainedRoots) {
  assert(root.startsWith(`${owned}/`));
  for (const record of await inventory(root)) retained.push({ ...record, path: `${relative(owned, root)}/${record.path}` });
}
retained.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
await save("retained-scratch-inventory.json", retained);
const supervisor = join(frozenRoot, "harness/process-manager.mjs");
assert.equal(hash(await readFile(supervisor)), pre.v9.records.find(record => record.path === "harness/process-manager.mjs").sha256);
assert.equal(hash(await readFile(pre.tools.tar.path)), pre.tools.tar.sha256);
const { ProcessManager } = await import(pathToFileURL(supervisor));
const manager = new ProcessManager({ defaultTimeoutMs: 120_000 });
const archive = join(owned, "retained-scratch.tar.data");
await writeFile(archive, Buffer.alloc(0), { flag: "wx" });
const archiveProcess = await manager.run(pre.tools.tar.path, ["--format=ustar", "-cf", archive, "-C", owned, ...retainedRoots.map(root => relative(owned, root))], { cwd: owned, env: { ...process.env, COPYFILE_DISABLE: "1", TMPDIR: join(owned, "temporary") } });
await manager.shutdown("evidence-archive-complete");
const archiveClosure = manager.assertClosed();
await save("archive-process.json", { ...archiveProcess, stdout: archiveProcess.stdout.toString(), stderr: archiveProcess.stderr.toString(), archiveClosure });
assert.equal(archiveProcess.status, 0);
assert(!archiveProcess.timedOut);
const archiveBytes = await readFile(archive);
const archived = [];
for (let offset = 0; offset + 512 <= archiveBytes.length;) {
  const header = archiveBytes.subarray(offset, offset + 512);
  if (header.every(byte => byte === 0)) break;
  const text = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/su, "");
  const name = text(0, 100);
  const prefix = text(345, 500);
  const path = prefix ? `${prefix}/${name}` : name;
  const size = Number.parseInt(text(124, 136).trim(), 8) || 0;
  const type = text(156, 157);
  if (type === "0" || type === "") {
    const bytes = archiveBytes.subarray(offset + 512, offset + 512 + size);
    archived.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  } else assert.equal(type, "5", `unexpected tar entry type ${type}: ${path}`);
  offset += 512 + Math.ceil(size / 512) * 512;
}
archived.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
assert.deepEqual(archived, retained);
const removed = [];
for (const root of retainedRoots) {
  await rm(root, { recursive: true });
  await assert.rejects(stat(root), error => error.code === "ENOENT");
  removed.push({ path: root, actualPostCleanupStat: "ENOENT" });
}
const remaining = await inventory(owned);
assert(!remaining.some(record => /\.(?:ts|mts)$/u.test(record.path)));
const counts = {
  verdict: "REJECTED_FROZEN_HARNESS_LINEAGE_ASSERTION",
  oneActualReplay: true,
  freeze: pre.v9.revision,
  manifestSha256: pre.v9.manifestSha256,
  candidate: pre.candidate.commit,
  fixtureFiles: 23,
  candidatePaths: 249,
  environmentRows: 16,
  build: { status: 0, exactCandidateInputsUnchangedIncludingNewEntries: true },
  originalSource: original.summary,
  freshSource: { processStatus: 1, timedOut: false, rawOkMarkers: 40, rawNotOkMarkers: 0, finalSummaryAccepted: false, stdoutBytes: 0, byLineageDerivedFromFrozenClassifierAndRawNames: byLineage, requiredLineage: { "historical-frozen-derived": 31, "postfreeze-lifecycle-addition": 2, "v5-observer-policy-control": 7 }, records: names.map((name, index) => ({ id: `V5-${String(index + 1).padStart(3, "0")}`, name, rawMarker: "ok", lineage: lineage(name) })) },
  measuredMetadata: { rawOkMarkers: names.filter(name => name.endsWith("v5 measured metadata contract")).length, rawNotOkMarkers: 0, detailedDeltaRecordsEmitted: false, authorizedDirectoryAtimeDeltaCount: null, unauthorizedDeltaCount: null, qualification: "All 19 case checks printed ok, including the zero-unauthorized rule. Full JSON was never emitted, so exact atime-delta counts and values cannot be reported; do not substitute inherited V8 counts." },
  candidateEnvironment: { declaredRows: 16, aggregateRawMarker: names.includes("literal 1500-byte three-level environment precedence table") ? "ok" : "missing", all16PassedInferredFromUnchangedEveryRowAssertion: true, rowPayloadsEmitted: false },
  timestampControls: { V5_023: "ok marker", V5_024: "ok marker", rawAtimeStatsEmitted: false },
  intentionalNegativeControls: { originalBehaviorMutants: original.results.filter(record => record.name.startsWith("negative control")).map(({name,pass}) => ({name,pass})), freshBehaviorMutantRawOkIds: [24,25,26,27,37,38,39].map(number => `V5-${String(number).padStart(3,"0")}`), agentsAdmission: bootstrap.admissionControl, invalidPacklist: bootstrap.packlistControl, timeoutGrandchild: timeoutClosure, qualification: "Expected mutant detections and the intentional timeout are separate from the unexpected fresh-suite exit 1." },
  unexecuted: ["scoped DU/Overlay regressions (declared 128)", "npm dry-run/pack/actual archive admission", "package unpack/dependency admission/install/move", "strict moved-consumer types/runtime", "moved-package original/fresh suites", "nextLoad package-source-byte attestation", "wrong-root/source-fallback negative", "missing-DU negative", "restored-cleanup installed mutant", "semantic-declaration negative", "16 native environment semantic rows"],
  blocker: { kind: "frozen-harness bookkeeping defect, not an established product or host-atime failure", changedRecord: "V5-024", changedName: names[23], classifierLine: 241, assertionLine: 1153, observedHistorical: 32, requiredHistorical: 31, consequence: "Name no longer starts with atime field scope; it enters historical-frozen-derived instead of observer-policy-control. Fatal assertion precedes JSON emission. No fixture repair or replay retry performed." },
  closure: { bootstrapRootsAndGroups: bootstrapHistory.records.length, materializedRootsAndGroups: history.records.length, outerReviewerReplayRootsAndGroups: 1, replayRootsAndGroupsTotal: processChecks.length, allGoneCheckedAgain: true, timeoutGrandchildAbsentAgain: true, processChecks, archiveProcessRootsAndGroups: 1, archiveProcessClosed: true, scratchRemoved: removed, zeroLooseTsOrMtsFiles: true, forbiddenAgentsFiles: 0 },
  retainedArchive: { path: relative(owned, archive), bytes: archiveBytes.length, sha256: hash(archiveBytes), regularFiles: archived.length, everyArchivedPayloadMatchesPreArchiveSha256: true },
  scope: { O060: "deferred/profile-gap/deterministic-ordering", v2ToV3Delta: "permanently unproved", priorHistory: "untouched, not replayed", publicDefaultDu: false, wholeGate: false, nativeParity: false },
  evidenceDirectory: relative(owned, evidence)
};
await save("RAW_COUNTS.json", counts);
process.stdout.write(json({ verdict: counts.verdict, original: counts.originalSource, fresh: { rawOk: 40, suiteExit: 1, lineage: byLineage }, processGroups: processChecks.length, archiveFiles: archived.length, scratchRemoved: removed.length, looseTypeScriptFiles: 0 }));

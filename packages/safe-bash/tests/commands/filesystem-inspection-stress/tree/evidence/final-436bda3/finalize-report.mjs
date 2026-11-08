import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async filename => JSON.parse(await readFile(join(directory, filename), 'utf8'));
const analysis = await json('analysis.json');
const freeze = await json('freeze.json');
const gate = await json('execution-gate.json');
const results = await json('initial-results.json');
const publication = await json('publication.json');
const target = publication.target;
const tap = await readFile(join(directory, 'durable-checks.tap'), 'utf8');
assert.match(tap, /# pass 6\n# fail 0/u);
assert.match(tap, /# cancelled 0\n# skipped 0\n# todo 0/u);
const liveGroups = [];
for (const row of results.cohort) {
  try { process.kill(-row.pid, 0); liveGroups.push(row.pid); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
assert.equal(liveGroups.length, 0);
const n16 = analysis.nativeLanes.find(row => row.id === 'N16');
const n18 = analysis.nativeLanes.find(row => row.id === 'N18');
const text = (bytes) => Buffer.from(bytes, 'base64').toString('utf8');
const detail = `FINAL TREE INDEPENDENT FROZEN REPLAY — STOP FOR ROOT SEAL
August 27, 2026. No commit/staging/root/default/production/author-test edits.
Owner: tests/commands/filesystem-inspection-stress/tree/** and own /tmp only.

EXACT SOURCE AND GATE
Candidate ${freeze.commit}
Git tree ${freeze.tree}
Immutable regular-file snapshot: ${freeze.candidateDirectory}
${freeze.candidateFileCount} committed regular files, ${freeze.candidateBytes} bytes;
${freeze.dependencyFileCount} copied regular devdependency files, ${freeze.dependenciesBytes} bytes.
No symlinked source/dependency imports, worktree, branch, install or rebuild of native.
Committed lock versions and copied byte hashes verify; eight installed package
records, zero runtime dependencies. No fresh tarball integrity recalculation.
Completed independent report read, not provisional/public announcement:
/tmp/safe-bash-inspection-safety-prep-detail.txt
Report SHA256 ${gate.completedPeerReportSha256}
Explicit Tree N18 v2 predicate GO; root final-source execution authorization
supplies the product gate that the peer preparation report itself did not grant.
Helper SHA256 ${gate.helperSha256}
Derived runner SHA256 ${gate.runnerSha256}
Original runner/corpus/native/physical fixtures unchanged. Only original N18
assertion and its import differ; v2 helper exact peer-reviewed bytes. Mechanical
profile changes only candidate hash/commit and author-finished evidence metadata.
API bridge/driver unchanged from initial; historical profile text remains visible.

MANIFESTS / PRESERVATION
Original preseal b9863722f41cbdd56119ab95c3446ca3b65a5b752ccafc28dc6f9044854d2937
Before and after: original316/v1 35/v2 37 durable artifacts and private97 verify.
Initial raw38, original regex failure, one fresh v1 run/HOLD, v2 offline results,
peer negatives, native20 and original seal remain byte-identical. No seal rewrite.
Candidate regular-file manifest ${freeze.commitManifestSha256}
Source manifest ${freeze.sourceManifestSha256}
Copied devdependency manifest ${freeze.dependencyManifestSha256}
Full input manifest ${freeze.fullInputManifestSha256}
All15617 files verified before and after; zero drift. Loaded source31 +devtools22;
all53 input module hashes captured, plus exact own harness hashes. No unexpected
moving-source/file-backed imports. Build/consumer closure31 file-backed modules;
125 build files +3 consumer input files hashed before/after, no drift.
Loaded source delta from initial includes four tree files AND committed
src/shell/shell.ts plugin-host admission/disposal change, not silently just tree.
Every old/new loaded hash is in analysis.json; no outside-core bug demonstrated.
Node ${analysis.runtime.version} ${analysis.runtime.platform}/${analysis.runtime.arch}
Executable ${analysis.runtime.executable}
Executable SHA256 ${analysis.runtime.executableSha256}

EXACT FRESH EXECUTION
Source cohort ${results.startedAt} through ${results.finishedAt}; ${results.elapsedMs}ms.
38 original selections exactly once; 35 actual tree invocations; 3 unsupported
selections import the bridge but DO NOT invoke tree. No product results reused.
31 raw predicate passes; 1 raw failure N16; 3 unsupported N09/N12/N19;
3 characterizations A24/A25/A26 (not passes). No missing/incomplete selections,
source/import/startup errors, harness watchdog cancellation or timeouts.
Deliberate cancellation tests execute and pass their unchanged assertions.
Per-case parent cap120s, total cap600s, original internal settlement cap2s.
No failed-case retry and no new extra hidden product/native oracle cases.
Result ID final-436bda3-k1mKIO; individual IDs raw/N01..N20, raw/A21..A38.
Fresh final result SHA256 ${analysis.resultSha256}
Filename initial-results.json is retained by unchanged driver; NOT old reuse.

RAW EXACT / SEMANTIC LANES
All20 original native captures: 12 exact match, 5 differences, 3 unsupported.
Exact-native predicate selections16:12 pass,1 N16 fail,3 unsupported.
Other native semantic selections4:4 pass, including fresh corrected N18.
Adversarial selections18:15 pass,3 characterizations.
Raw differences unchanged N14/N16/N17/N18/N20; no new parity promotion.
N16 remains root-accepted declared nofollow-rootlink difference, NO sourcefix:
  argv ${JSON.stringify(n16.native.argv)}
  native status${n16.native.exitCode}, stdout ${JSON.stringify(text(n16.native.stdoutBase64))}
  product status${n16.output.exitCode}, stdout ${JSON.stringify(text(n16.output.stdoutBase64))}
N18 final v2 semantic PASS, not native parity:
  product status${n18.output.exitCode}, stdout empty, stderr ${JSON.stringify(text(n18.output.stderrBase64))}
  native status${n18.native.exitCode}, stderr ${JSON.stringify(text(n18.native.stderrBase64))}
  zero FS calls; finite depth-bound diagnostic profile, not generic nonempty text.
Ancestor-only handling is OUR chosen bounded profile, not a literal user instruction.
Root route /tmp/safe-bash-tree-final-replay-failures.txt: no new source failures.
Original /tmp/safe-bash-tree-holdout-failures.txt remains unchanged history.

NATIVE PROVENANCE — READ/HASH ONLY, ZERO NEW NATIVE CALLS
Existing official tree2.2.1 Darwin arm64 oracle; LC_ALL=C LANG=C TERM=dumb TZ=UTC,
-n --charset=ASCII; original20 bytes/statuses unchanged. Not GNU/Linux proof.
Archive SHA256 e911c4a2bea53586cc7be6f3d7d7f4d9c2f2bcbbad77d30700b31046e38f4bc5
Binary SHA256 34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a
Existing archive/binary bytes independently rechecked. Original exact build
command, raw metadata and primary-source provenance remain in initial evidence.
No recapture, download, rebuild or hidden broad native oracle.

SCOPED TYPES / BUILT PLUGIN / SAFETY
Scoped frozen compiler PASS: all15 canonical tree source/test/helper TS files
present in successful226-file compiler list; zero missing. Not inventory alone.
Isolated build PASS, outside frozen source/live dist. Typed standalone consumer
PASS (189 compiler inputs); plain Node actual Shell treeCommands plugin smoke
PASS, one separate tree invocation, no tsx/live import; all three factory APIs typed.
ID BUILT-STANDALONE-SMOKE-1; output / followed by leaf.txt, status0/empty stderr;
Shell disposed. This is separate from38; final total fresh tree calls36, native0.
Source cohort directly imports src/commands/tree/index.ts createTreeCommand.
Built smoke imports emitted commands/tree/index.js treeCommands/createTreeCommands/
createTreeCommand. No public root/subpath/default registration/integration claim.
Actual A37 Shell JSON pipeline/subshell/redirect/consumer/relay passes unchanged.
Direct pendingFS/sink abort +late rejection/backpressure/partial-output/entry and
output limits all run unchanged; no low-case budget relaxation required.
Static final matcher/sort/text delta reviewed: cumulative finite DP; comparison
byte cost and dirsfirst cost; raw text admission before scans; bounded escaping/
JSON sizing; scoped identity not realpath authority; VFS metadata only; no tree
contentread/implicit hostFS/subprocess/network/runtime dependency. Full rationale
STATIC-DELTA.md. No separate peer six-case safety corpus executed here.

DURABLE EVIDENCE / LIMITS / CLEANUP
${target}
358 primary manifested artifacts; ${publication.publishedBytes} bytes.
FINAL-MANIFEST.json SHA256 ${publication.manifestSha256}
Payload SHA256 ${publication.payloadSha256}
Offline builtin evidence checks6/6 pass,0fail/skip/cancel/TODO, no product imports.
Final detail/test log tail bound separately by FINAL-RECEIPT.json. Raw58MiB V8
coverage remains /tmp and indexed by hashes; do not infer missing capture from
not duplicating it. Source snapshot/devdeps/build and exact native fixtures retained.
A33 tests C-escaped ASCII output for Unicode names, not genuine UTF8 output bytes;
A25 exits at first malformed name; A26 entry cap precedes duplicate validation.
Unknown/malicious host-contract rows are characterizations, not invented rejection
requirements. No jq-specific/deployed provider/performance/fullgate/parity claim.
All38 owned child groups absent on final check, build/compiler/smoke child PIDs
closed, Shells disposed, no kill/retry or owned service/watcher remains. Existing
opaque host-work caveat remains. No unrelated processes/fixtures cleaned up.
One initial read-only zsh inspection shadowed PATH; later static reads had a
missing-file/glob error. Those inspections were corrected, never product reruns.
Concurrent root/other-owner commits changed live git status; exact frozen inputs
and our existing artifacts remained unchanged. No staging or commit performed.
STOP for root seal/peer routing; no further product execution authorized here.
`;
await writeFile('/tmp/safe-bash-tree-final-replay-detail.txt', detail, { flag: 'wx' });
await writeFile(join(directory, 'final-replay-detail.txt'), detail, { flag: 'wx' });
await copyFile(join(directory, 'final-replay-detail.txt'), join(target, 'final-replay-detail.txt'), constants.COPYFILE_EXCL);
for (const name of ['durable-checks.tap', 'durable-checks.stderr.txt', 'publication.json', 'finalize-report.mjs']) {
  await copyFile(join(directory, name), join(target, name), constants.COPYFILE_EXCL);
}
const tailFiles = [];
for (const path of ['FINAL-MANIFEST.json', 'final-replay-detail.txt', 'durable-checks.tap', 'durable-checks.stderr.txt', 'publication.json', 'finalize-report.mjs']) {
  const bytes = await readFile(join(target, path)); tailFiles.push({ path, bytes: bytes.length, sha256: hash(bytes) });
}
const receipt = { schema: 1, at: new Date().toISOString(), phase: 'STOP_FOR_ROOT_SEAL_NO_COMMIT', candidate: freeze.commit,
  primaryArtifacts: 358, offlineChecks: { pass: 6, fail: 0, skip: 0, cancel: 0 }, newProductCallsAfterCohortAndSmoke: 0,
  liveOwnedChildGroups: liveGroups, payloadSha256: hash(JSON.stringify(tailFiles)), files: tailFiles };
await writeFile(join(target, 'FINAL-RECEIPT.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ detailSha256: hash(detail), receiptSha256: hash(await readFile(join(target, 'FINAL-RECEIPT.json'))), liveGroups, verdict: 'STOP_FOR_ROOT_SEAL' }, null, 2));

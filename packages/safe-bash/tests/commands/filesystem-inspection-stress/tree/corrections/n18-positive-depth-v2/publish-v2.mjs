import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, cp, lstat, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const base = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/tree';
const v1 = join(base, 'corrections/n18-positive-depth');
const destination = join(base, 'corrections/n18-positive-depth-v2');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const originalManifest = await readFile(join(base, 'EVIDENCE-MANIFEST.json'));
const v1Manifest = await readFile(join(v1, 'CORRECTION-MANIFEST.json'));
assert.equal(hash(originalManifest), '66ecd953ee0959f249387b3eab9f7d9f20afa32eca36bb123a82810187997b01');
assert.equal(hash(v1Manifest), '18cb04609766ba7ee13a8f2d6a5d41094ebe58e63cdffb298f61f12c81c9d5d6');
async function verify(root, entries) {
  for (const entry of entries) {
    const path = join(root, entry.path);
    const data = (await lstat(path)).isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path);
    assert.equal(hash(data), entry.sha256, path);
  }
}
await verify(base, JSON.parse(originalManifest).entries);
await verify(v1, JSON.parse(v1Manifest).files);
const privateOriginal = '/tmp/safe-bash-tree-hidden-prep-vyzfHc';
const seal = await json(join(base, 'PRESEAL-MANIFEST.json'));
const privateInventory = await readFile(join(privateOriginal, 'inventory.json'));
assert.equal(hash(privateInventory), seal.privateInventorySha256);
await verify(privateOriginal, JSON.parse(privateInventory));
const delta = await json(join(directory, 'helper-delta.json'));
const offline = await json(join(directory, 'offline-capture-evaluation.json'));
const peer = await json(join(directory, 'peer-countercheck-results.json'));
assert.equal(offline.productExecutions, 0);
assert.equal(offline.nativeExecutions, 0);
assert.ok(peer.peerObservations.every((entry) => entry.v2Accepted === entry.semanticallyAcceptable));
const testLog = await readFile(join(directory, 'v2-pure-checks.tap'), 'utf8');
assert.match(testLog, /# tests 47\n# suites 0\n# pass 47\n# fail 0/u);
assert.equal(hash(await readFile(join(directory, 'predicate.test.mjs'))), hash(await readFile(join(v1, 'predicate.test.mjs'))));
for (const name of ['run.mjs', 'corpus.mjs', 'fixture-fs.mjs', 'native.json']) {
  assert.equal(hash(await readFile(join(directory, 'derived', name))), hash(await readFile(join(v1, 'derived', name))), name);
}
const preservation = {
  checkedAfterAt: new Date().toISOString(), originalPresealPayload: seal.payloadSha256,
  originalEvidenceManifestSha256: hash(originalManifest), v1CorrectionManifestSha256: hash(v1Manifest),
  originalDurableArtifactsUnchanged: 316, v1ArtifactsUnchanged: 35, originalPrivateArtifactsUnchanged: 97,
  initialRaw38Sha256: hash(await readFile(join(base, 'evidence/initial/initial-results.json'))),
  historicalV1FreshResultSha256: hash(await readFile(join(v1, 'corrected-result.json'))),
  originalV1PredicateSha256: hash(await readFile(join(v1, 'n18-predicate.mjs'))),
  peerCounterchecksSnapshotSha256: hash(await readFile(join(directory, 'history/peer-counterchecks.original.mjs.txt'))),
  peerAuthorizedSectionSnapshotSha256: hash(await readFile(join(directory, 'history/peer-completed-harness-section.md'))),
  unchangedDerivedRunnerSha256: delta.derivedRunnerSha256,
  productExecutionsThisV2Work: 0, nativeExecutionsThisV2Work: 0, currentAuthorSafetyFixImported: false,
};
await writeFile(join(directory, 'preservation-after.json'), `${JSON.stringify(preservation, null, 2)}\n`, { flag: 'wx' });
const detail = `TREE N18 HARNESS V2 — PURE COUNTERCHECKS / OFFLINE CAPTURES ONLY; STOPPED FOR PEER

Recorded UTC: ${preservation.checkedAfterAt}
Scope: additive tests/commands/filesystem-inspection-stress/tree/corrections/n18-positive-depth-v2/** and owned /tmp only.
Private evidence: ${directory}
Product command executions this v2 work:ZERO.
Native oracle/tool executions this v2 work:ZERO.
Current author safety-fix source imports/inspection/execution:ZERO.
No full38 or other case invocation, source/root/default edit, staging or commit.

PEER HOLD AND BOUNDED FIX
Read only SAFETY_FINDINGS.md's Completed harness correction verdicts section
and the requested correction-counterchecks.mjs. Retained their exact authorized
section/script snapshots; the mixed tree/file peer script was NOT executed.
Actual unchanged v1 helper reproduces both peer false accepts:
1 ${JSON.stringify(peer.peerObservations[1].stderr)}
2 ${JSON.stringify(peer.peerObservations[2].stderr)}
V1 accepts both; v2 rejects both. Their negative meaning and original HOLD remain.

V2 uses five anchored whole-diagnostic forms. A depth subject (-L, level,
depth, or maximum depth) directly owns its positive constraint. The complete
trimmed diagnostic must match; -L is case-sensitive. Positive numeric bounds
are safe integers and ordered; zero-inclusive/reversed/fractional/unsafe bounds
fail. Exact nonzero status, byte I/O, empty stdout and bounded nonempty stderr
guards from v1 are unchanged. Current/native diagnostic strings are examples,
not hardcoded full expected strings; independent positive variants also pass.
Extra clauses or internal lines fail wholesale, including consistent extra
lines outside the finite profile. Thus contradictory bounds on a second line
cannot be filtered out or ignored. This is deliberately NOT a generic natural-
language parser, nor a claim to accept every reasonable diagnostic spelling.

EXACT DELTA / HASHES
Original preseal payload: ${seal.payloadSha256}
V1 predicate: ${delta.v1Sha256}
V2 predicate: ${delta.v2Sha256}
Exact unified diff: ${delta.diffSha256}
Helper delta:19 inserted lines,16 deleted lines (minimum line-edit LCS delta).
Pure forward/reverse application of helper.diff reconstructs exact v2/v1 bytes.
Derived runner unchanged: ${delta.derivedRunnerSha256}
Corpus/native fixtures/fixture FS and copied31-check v1 test file unchanged.
No runner assertion other than the already-derived N18 helper binding changes.
Original regex failure, original seal, initial raw38, v1 one-fresh result and
predicate, and peer failure evidence remain byte-exact. Original manifests are
not regenerated; v2 gets its own additive manifest and pending-review record.

PURE CHECKS / OFFLINE EVALUATION
Authoritative v2 checks:47 tests,47pass,0fail/skip/cancel/TODO.
31 unchanged checks from v1 run against v2, plus16 peer/subject/diagnostic/
independent-positive/reversal checks. These use Node builtins and local harness
helpers only. Two peer negatives rejected; positive-control retained. Existing
status/stdout/stderr/numeric counterchecks remain. Original v1 false accepts
are reproduced as known bad history, not promoted by passing reproduction tests.

Offline re-evaluation only:three already-captured records are accepted by v2:
initial productN18, historical one-fresh v1 productN18, and original nativeN18.
These are data reads and helper calls, NOT new product/native executions.
Their captured source provenance is old e2d1b9230f4304650651572395523ca9d1644e74;
no current safety-fix source was frozen, inspected or tested by this task.
Original native status1 versus historical product usage2 and diagnostic-byte
differences remain raw native-not-parity. Initial38 stays30pass/2fail/
3unsupported/3characterizations. V1's fresh N18 raw result stays historical and
on peer HOLD; v2 offline acceptance is not a new fresh case, cohort pass count,
source-safety verdict, or peer GO. No mixed31-pass claim is newly approved here.
N16 remains an accepted declared nofollow profile difference, not native parity.
Ancestor-only handling is our chosen profile, not a literal user instruction.

PRESERVATION / PREPARATION HISTORY
Before/after verified316 original durable artifacts,35 v1 correction artifacts,
97 original private preseal artifacts unchanged. Initial raw38 SHA256:
${preservation.initialRaw38Sha256}
Historical v1 fresh result SHA256:
${preservation.historicalV1FreshResultSha256}
Original evidence manifest: ${preservation.originalEvidenceManifestSha256}
V1 correction manifest: ${preservation.v1CorrectionManifestSha256}

First preparation attempt failed: copied v1 helper inherited read-only mode;
apply_patch could not edit the new copy and make-diff.mjs did not exist yet.
The subsequent31 copied-old-helper checks were not v2 verification; their log
and explicit failure record are retained. Only the new v2 copy was made writable.
The corrected v2 edit then passed the authoritative47-check run. No product
execution, source change or historical-file mutation occurred in either attempt.

HANDOFF / LIMITS / CLEANUP
Durable folder: tests/commands/filesystem-inspection-stress/tree/corrections/n18-positive-depth-v2/
Key artifacts: n18-predicate.mjs, helper.diff, helper-delta.json,
peer-countercheck-results.json, offline-capture-evaluation.json,
v2-pure-checks.tap, diff-roundtrip.json and preservation-before/after.json.
All pure scripts completed. Product/native processes launched:0; active owned
product/native children:0; watchers/servers started:0. No unowned cleanup or
temporary evidence deletion performed. Raw history and preparation logs retained.
Finite English single-diagnostic profile only; extra lines/clauses are rejected,
not interpreted. No runtime/source validation of the author's ongoing safety
fix and no final38 gate. Root will separately authorize a full38 run after
new source freeze and peer GO. No commit. STOP for the requested peer review.
`;
await writeFile('/tmp/safe-bash-tree-harness-v2-detail.txt', detail, { flag: 'wx', mode: 0o600 });
await copyFile('/tmp/safe-bash-tree-harness-v2-detail.txt', join(directory, 'v2-detail.txt'));
for (const entry of await readdir(directory, { withFileTypes: true })) {
  await cp(join(directory, entry.name), join(destination, entry.name), { recursive: entry.isDirectory(), force: false, errorOnExist: true, dereference: false, verbatimSymlinks: true });
}
const files = [];
async function collect(prefix = '') {
  const entries = await readdir(join(destination, prefix), { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (name === 'V2-MANIFEST.json') continue;
    if (entry.isDirectory()) { await collect(name); continue; }
    const data = await readFile(join(destination, name));
    files.push({ path: name, bytes: data.length, sha256: hash(data) });
  }
}
await collect();
const manifest = { schema: 1, verdict: 'PENDING_PEER_REVIEW', originalPresealPayload: seal.payloadSha256,
  originalEvidenceManifestSha256: hash(originalManifest), v1CorrectionManifestSha256: hash(v1Manifest),
  v2PredicateSha256: delta.v2Sha256, exactDiffSha256: delta.diffSha256, productExecutions: 0, nativeExecutions: 0,
  offlineSavedRecordsEvaluated: 3, pureTests: 47, payloadSha256: hash(JSON.stringify(files)), files };
await writeFile(join(destination, 'V2-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
await verify(destination, files);
console.log(JSON.stringify({ published: destination, artifactsVerified: files.length, v2PayloadSha256: manifest.payloadSha256, pureTestsPassed: 47,
  offlineSavedRecordsAccepted: 3, newProductExecutions: 0, newNativeExecutions: 0, verdict: manifest.verdict }));

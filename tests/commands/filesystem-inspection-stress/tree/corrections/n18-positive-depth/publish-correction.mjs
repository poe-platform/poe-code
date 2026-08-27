import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, cp, lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const base = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/tree';
const destination = join(base, 'corrections/n18-positive-depth');
const initial = '/tmp/safe-bash-tree-initial-run-NN3E3X';
const candidate = await realpath(join(initial, 'candidate'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const result = await json(join(directory, 'corrected-result.json'));
const declaration = await json(join(directory, 'derivation.json'));
const originalResults = await json(join(initial, 'initial-results.json'));
const observation = await json(join(directory, 'raw/N18/observations.json'));
assert.equal(observation.invocations.length, 1);
assert.equal(result.rawPredicate.status, 'pass');
const product = observation.invocations[0];
const originalProduct = (await json(join(initial, 'raw/N18/observations.json'))).invocations[0];
const native = (await json(join(directory, 'derived/native.json'))).find((entry) => entry.id === 'N18');
const accepted = (invocation, stream) => Buffer.concat(invocation[stream].filter((entry) => entry.state === 'fulfilled').map((entry) => Buffer.from(entry.attemptedBase64, 'base64')));
const stdout = accepted(product, 'stdout');
const stderr = accepted(product, 'stderr');
assert.deepEqual(product.argv, native.argv);
assert.deepEqual(product.result, originalProduct.result);
assert.deepEqual(stdout, accepted(originalProduct, 'stdout'));
assert.deepEqual(stderr, accepted(originalProduct, 'stderr'));
const rawComparison = { id: 'N18', productExitCode: product.result.exitCode, productStdoutBase64: stdout.toString('base64'), productStderrBase64: stderr.toString('base64'),
  originalNative: native, sameProductBytesAndStatusAsInitial: true,
  rawNativeStatusEqual: product.result.exitCode === native.exitCode,
  rawNativeStdoutEqual: stdout.toString('base64') === native.stdoutBase64,
  rawNativeStderrEqual: stderr.toString('base64') === native.stderrBase64,
  rawNativeClassification: 'mismatch-not-parity-pass', correctedSemantic: 'pass' };
await writeFile(join(directory, 'native-comparison.json'), `${JSON.stringify(rawComparison, null, 2)}\n`, { flag: 'wx' });
await writeFile(join(directory, 'raw/N18/product.stdout.bin'), stdout, { flag: 'wx' });
await writeFile(join(directory, 'raw/N18/product.stderr.bin'), stderr, { flag: 'wx' });
const mapping = originalResults.cohort.map((entry) => ({
  id: entry.id, originalRawStatus: entry.status,
  selectedEvidence: entry.id === 'N18' ? 'fresh-corrected-N18' : 'reused-initial-selection',
  adjudicatedStatus: entry.id === 'N18' ? 'semantic-pass' : entry.id === 'N16' ? 'accepted-profile-difference-not-native-parity' : entry.status === 'pass' ? 'semantic-pass' : entry.status,
  originalEvidence: `../../evidence/initial/raw/${entry.id}/stdout.txt`,
  ...(entry.id === 'N18' ? { freshEvidence: 'raw/N18/stdout.txt' } : {}),
}));
const adjudication = { sourceCommit: declaration.candidate, selectionCount: 38, freshSelections: 1, reusedSelections: 37,
  rawInitialCountsUnchanged: originalResults.totals, semanticView: { semanticPass: 31, acceptedProfileDifferenceNotParity: 1, unsupportedNotPass: 3, characterizedNotPass: 3 },
  semanticPassOrigins: { reusedInitialPasses: 30, freshCorrectedN18: 1 },
  correctionProductInvocations: 1, cumulativeInitialPlusCorrectionProductInvocations: 36,
  otherCasesRerun: 0, newNativeOracleCalls: 0, full38Rerun: false, mapping };
await writeFile(join(directory, 'semantic-adjudication.json'), `${JSON.stringify(adjudication, null, 2)}\n`, { flag: 'wx' });
const inputManifest = new Map((await json(join(initial, 'full-input-files.json'))).map((entry) => [entry.path, entry]));
const loaded = new Map();
const outside = new Set();
for (const name of await readdir(join(directory, 'raw/N18/coverage'))) {
  const coverage = await json(join(directory, 'raw/N18/coverage', name));
  for (const script of coverage.result) {
    let path;
    if (script.url.startsWith('file:')) path = fileURLToPath(script.url);
    else if (isAbsolute(script.url)) path = script.url;
    else continue;
    path = await realpath(path);
    if (path.startsWith(`${candidate}/`)) {
      const name = relative(candidate, path);
      const entry = inputManifest.get(name);
      assert.ok(entry, name);
      assert.equal(digest(await readFile(path)), entry.sha256, name);
      loaded.set(name, { path: name, sha256: entry.sha256 });
    } else if (!path.startsWith(`${await realpath(directory)}/`)) outside.add(path);
  }
}
assert.equal(outside.size, 0);
const loadAudit = { files: [...loaded.values()].sort((left, right) => left.path.localeCompare(right.path)), unexpectedFileBackedImports: [...outside], allLoadedCandidateInputsMatchFrozenManifest: true };
await writeFile(join(directory, 'source-load-audit.json'), `${JSON.stringify(loadAudit, null, 2)}\n`, { flag: 'wx' });
await copyFile(join(initial, 'raw/N18/stdout.txt'), join(directory, 'original-N18-regex-failure.stdout.txt'));
await copyFile(join(initial, 'raw/N18/observations.json'), join(directory, 'original-N18-observations.json'));
const detail = `TREE N18 ADDITIVE HARNESS CORRECTION — ONE FRESH INVOCATION; STOPPED

Candidate: ${declaration.candidate}
Existing frozen snapshot: ${candidate}
Source manifest SHA256: ${declaration.frozenSourceManifestSha256}
Full input manifest SHA256: ef040b94780aa38b5483d5d1c2f9d263e4396cc8a0d881255665080992cce1e8
Original preseal payload: ${declaration.originalPresealPayload}
Original runner SHA256: ${declaration.files['original-run.mjs']}
Derived runner SHA256: ${declaration.files['derived/run.mjs']}
New predicate SHA256: ${declaration.files['n18-predicate.mjs']}
Exact derived diff SHA256: ${declaration.files['runner.diff']}
Original corpus SHA256: ${declaration.files['derived/corpus.mjs']}
Original native fixture SHA256: ${declaration.files['derived/native.json']}

AUTHORITY / EXACT CHANGE
Root adjudicated N18 as an overnarrow harness predicate, not a source bug.
Derived run.mjs adds one helper import and replaces only the N18 assertion.
No other predicates, corpus inputs, native bytes/status, bridge or supported
profile changed. Exact inverse replacement reproduces the original runner bytes.
Original shared nonzero/nonempty checks stay intact. New N18 helper also enforces
empty normal stdout and a bounded nonempty error diagnostic in stderr.
The diagnostic must identify -L (case-sensitive), level or depth and impose
a positive bound/range. It accepts several forms rather than the candidate's
complete string: positive integer, exclusive nonnegative lower bound, inclusive
positive minimum, ordered positive inclusive bounds or explicit positive range.
Recognized zero-inclusive/reversed/fractional/unsafe/contradictory bounds fail.
No blanket any-nonempty diagnostic relaxation. Full predicate/grammar and exact
predeclared-profile justification are in derivation.json and n18-predicate.mjs.
Ancestor-only handling remains our chosen profile, NOT literal user instruction.

COUNTERCHECKS / SINGLE PRODUCT CALL
31 nonproduct checks pass:8 positive examples,22 rejection counterchecks,
1 exact derivation/corpus/native hash check. Counterchecks reject success,
empty/whitespace/unrelated diagnostics, wrong flag, nonempty stdout, diagnostic
only on stdout, zero bounds, negative/reversed/fractional/unsafe bounds and
explicitly contradictory zero allowance. These checks invoke no product/native.
Exactly ONE corrected N18 invocation: ${result.startedAt} to ${result.finishedAt},
${result.elapsedMs}ms; Node ${result.node}. Existing frozen copied tsx/devdeps only.
Fresh predicate result:PASS. Product exitCode2; stdout0bytes; stderr35bytes;
filesystem calls0. Exact stderr: ${JSON.stringify(stderr.toString())}
Product stdout/stderr/status equal the original initial N18 observation exactly.
Native original remains status1 with original diagnostic; raw exact mismatch
remains. There is no source change and no native parity promotion.
Other37 selections rerun:ZERO. Native oracle calls/captures:ZERO. Source fixes:ZERO.
Actual new tree invocations:1 (initial35 + correction1 =36 historical calls).
120-second process watchdog and original2-second settlement guard unchanged;
neither fired. Single-invocation lock is retained; no retry occurred.

SEPARATE ADJUDICATION, NOT A FULL38 RERUN
Initial raw38 results unchanged:30pass,2fail,3unsupported,3characterizations.
Mapping reuses37 initial selections and substitutes one fresh correctedN18.
Semantic view:31passes =30reused +1fresh; accepted N16 profile difference1;
unsupported3 and characterizations3 remain NOT passes. N16 is root-accepted
rootlink nofollow, still native-not-parity, with no source fix. Original N18
regex failure and native status1/product status2 difference remain byte-exact.
semantic-adjudication.json provides a row-by-row reused-versus-fresh mapping.

PRESERVATION / PROCESS STATE
Before and after:97 original private artifacts,316 original published artifacts,
186 original raw files,76 original coverage files and all14205 frozen source/
dependency files verify unchanged. Original preseal, original public evidence
manifest, initial38 results and original regex-failure bytes are preserved.
Fresh coverage observes ${loaded.size} candidate/tool modules inside the same frozen
snapshot; unexpected moving file-backed imports0. Full source-load hashes retained.
Only additive tree-stress correction files and owned /tmp written. Existing
production/root/default/FS/core/contracts/private/unowned files not modified.
One owned child emitted close; active owned children0; no service/watcher started.
No timeout/cancellation, unowned process cleanup or temp deletion. Raw logs,
coverage, copied corpus, original failure and single-invocation lock retained.

DURABLE HANDOFF / LIMITS
Published: tests/commands/filesystem-inspection-stress/tree/corrections/n18-positive-depth/
Private: ${directory}
Correction manifest is additive; original manifests are not regenerated.
Remaining limits:bounded English diagnostic forms, not universal text semantics;
no other37-case validation, native replay, broad/full suite, public/default
integration or new source correctness claim. Prior coverage gaps stay unchanged.
No staging or commit. Root's narrow different-peer review is pending before
final stress commits/integration handoff. STOP after this bounded correction.
`;
await writeFile('/tmp/safe-bash-tree-harness-correction-detail.txt', detail, { flag: 'wx', mode: 0o600 });
await copyFile('/tmp/safe-bash-tree-harness-correction-detail.txt', join(directory, 'correction-detail.txt'));
for (const entry of await readdir(directory, { withFileTypes: true })) {
  await cp(join(directory, entry.name), join(destination, entry.name), { recursive: entry.isDirectory(), force: false, errorOnExist: true, dereference: false, verbatimSymlinks: true });
}
const files = [];
async function inventory(prefix = '') {
  const entries = await readdir(join(destination, prefix), { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (name === 'CORRECTION-MANIFEST.json') continue;
    if (entry.isDirectory()) { await inventory(name); continue; }
    const data = await readFile(join(destination, name));
    files.push({ path: name, bytes: data.length, sha256: digest(data) });
  }
}
await inventory();
const manifest = { schema: 1, originalPreseal: declaration.originalPresealPayload,
  originalEvidenceManifestSha256: '66ecd953ee0959f249387b3eab9f7d9f20afa32eca36bb123a82810187997b01',
  sourceCommit: declaration.candidate, freshProductInvocations: 1, otherSelectionsReused: 37,
  newNativeOracleInvocations: 0, payloadSha256: digest(JSON.stringify(files)), files };
await writeFile(join(destination, 'CORRECTION-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
for (const entry of files) assert.equal(digest(await readFile(join(destination, entry.path))), entry.sha256);
assert.equal(digest(await readFile(join(base, 'EVIDENCE-MANIFEST.json'))), manifest.originalEvidenceManifestSha256);
assert.ok((await lstat(destination)).isDirectory());
console.log(JSON.stringify({ published: destination, artifactsVerified: files.length, correctionPayloadSha256: manifest.payloadSha256, result: 'N18 semantic pass / native mismatch retained', productInvocations: 1, otherCasesRerun: 0, nativeCalls: 0 }));

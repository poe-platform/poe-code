import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { hash, inventory, read, save } from '../../html-to-markdown-independent-20260827/fix-review-3ef5811f/common.mjs';
import { writeFileSync } from 'node:fs';

const own = dirname(fileURLToPath(import.meta.url)), repo = resolve(own, '../../../..');
const early = join(repo, 'src/commands/html-to-markdown/node_modules/inline-normalization-early');
const fixedPath = join(repo, 'src/commands/html-to-markdown/node_modules/inline-normalization-fix/fixed-01');
const baseline = read(join(early, 'baseline-04/RESULT.json')), fixed = read(join(fixedPath, 'RESULT.json'));
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repo, maxBuffer: 16 * 1024 * 1024 }).toString().trim();
assert(!fixed.error); assert(fixed.membershipVerifiedBeforeAfterIncludingNewEntries);
assert(!baseline.error); assert(baseline.membershipVerifiedBeforeAfterIncludingNewEntries);
assert.equal(fixed.revision, git('rev-parse', '9ae34a06'));
assert.equal(baseline.htmlTree, git('rev-parse', '3ef5811f:src/commands/html-to-markdown'));
assert.equal(fixed.htmlTree, git('rev-parse', fixed.revision + ':src/commands/html-to-markdown'));
assert.equal(git('diff', fixed.revision, '--', 'src/commands/html-to-markdown'), '');
const originalNames = ['render.test.ts', 'io.test.ts', 'limits.test.ts', 'adversarial.test.ts', 'repair.test.ts', 'helpers.ts', 'fix-review/semantics.json', 'fix-review/worker.mjs'];
for (const name of originalNames) {
  const path = 'tests/commands/html-to-markdown/' + name;
  assert.equal(fixed.sourceBefore[path], baseline.sourceBefore[path]);
  assert.equal(fixed.sourceBefore[path], hash(readFileSync(join(repo, path))));
}
const sourceDiff = git('diff', '--name-only', baseline.revision, fixed.revision, '--', 'src');
const originalReview = join(repo, 'tests/commands/html-to-markdown-independent-20260827/fix-review-3ef5811f');
const priorCompressed = Buffer.from(readFileSync(join(originalReview, 'run05.json.gz.base64'), 'utf8'), 'base64');
assert.equal(hash(priorCompressed), read(join(originalReview, 'VERIFIED.json')).compressedSHA256);
const priorArchive = JSON.parse(gunzipSync(priorCompressed)), priorState = JSON.parse(Buffer.from(priorArchive['state.json'], 'base64'));
const authenticatedTools = {};
for (const name of ['typescript', '@types/node', 'undici-types']) {
  const prefix = 'node_modules/' + name + '/';
  const observed = Object.fromEntries(Object.entries(fixed.toolsBefore).filter(([path]) => path.startsWith(prefix)).map(([path, value]) => [path.slice(prefix.length), value]));
  assert.deepEqual(observed, priorState.toolchain[name].files);
  authenticatedTools[name] = { files: Object.keys(observed).length, inventorySHA256: hash(JSON.stringify(observed)), lock: priorState.toolchain[name].lock, priorVerifiedCapture: 'a327e0b58695067aa26d3e9b6d47d8f84f3755ab650ceef11c99566a7b4650c6' };
}
assert.deepEqual(fixed.node, priorState.toolchain.node);
assert.deepEqual(fixed.npmBefore, priorState.toolchain.npm.files);
assert.equal(fixed.pandoc.sha256, priorState.toolchain.pandoc.sha256);
const phases = {};
for (const row of fixed.rows) {
  assert.equal(row.outcome, 'PASS', row.phase + '/' + row.id);
  assert.equal(row.killed, false); assert.equal(row.signal, null); assert.equal(row.processGroupGone, true);
  const phase = phases[row.phase] ??= { receipts: 0, natural: 0, expectedNegativeStatuses: 0 };
  phase.receipts++; phase.natural++; if (row.status !== 0) phase.expectedNegativeStatuses++;
}
for (const layout of ['source', 'moved']) {
  for (const [name, count] of [['new34', 34], ['author22', 22], ['nested3', 3]]) {
    assert.equal(fixed.counts[layout][name].count, count); assert.equal(fixed.counts[layout][name].astPass, count);
  }
  for (const [name, count] of [['author55', 55], ['stress28', 28], ['controlled-abort', 6], ['normalization-abort', 2], ['scan-abort', 4], ['direct-work', 8], ['host-negative', 4], ['types', 4]]) assert.equal(phases[layout + '-' + name].receipts, count);
  const original = baseline.ast.filter(row => row.layout === layout && row.cohort === 'new34').slice(0, 10);
  assert.equal(original.filter(row => row.outcome === 'FAIL').length, 7);
  assert.equal(original.filter(row => row.outcome === 'PASS').length, 3);
}
const aborts = fixed.rows.filter(row => /-(?:controlled-abort|normalization-abort|scan-abort)$/u.test(row.phase));
for (const row of aborts) { assert.equal(row.result.actual.reasonIdentity, true); assert(row.result.actual.settlementMs < 1000); }
const entry = 'commands/html-to-markdown/index.js';
const emittedDiff = [];
for (const path of new Set([...Object.keys(baseline.emittedBefore), ...Object.keys(fixed.emittedBefore)])) if (baseline.emittedBefore[path] !== fixed.emittedBefore[path]) emittedDiff.push({ path, baseline: baseline.emittedBefore[path], fixed: fixed.emittedBefore[path], locationMap: path.endsWith('.map') });
async function hashFile(path) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest('hex');
}
const retainedArchives = [];
for (const [label, path] of [...['baseline-01', 'baseline-02', 'baseline-03', 'baseline-04'].map(label => [label, join(early, label)]), ['fixed-01', fixedPath]]) {
  const sha256 = await hashFile(join(path, 'candidate.tar'));
  if (label === 'fixed-01') assert.equal(sha256, fixed.archiveSHA256);
  retainedArchives.push({ label, path: join(path, 'candidate.tar'), sha256, binding: label === 'fixed-01' ? 'pre/post-run tar hash and pre/post full regular Git blob/membership checks' : 'post-run tar hash; successful baseline also pre/post full regular Git blob/membership checks' });
}
assert.equal(new Set(retainedArchives.slice(0, 4).map(row => row.sha256)).size, 1);
const files = {}, manifest = {};
function add(name, path) {
  const bytes = readFileSync(path);
  files[name] = bytes.toString('base64'); manifest[name] = { sha256: hash(bytes), bytes: bytes.length };
}
function collect(root, prefix, relative = '') {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const path = relative + entry.name;
    if (!relative && ['candidate', 'tools', 'compiled', 'moved', 'installation', 'home', 'npm-cache', 'candidate.tar'].includes(entry.name)) continue;
    if (entry.isDirectory()) collect(root, prefix, path + '/');
    else { assert(entry.isFile()); add(prefix + '/' + path, join(root, path)); }
  }
}
for (const label of ['baseline-01', 'baseline-02', 'baseline-03', 'baseline-04']) {
  const path = join(early, label); collect(path, label);
  const tarball = join(path, 'compiled/virtual-bash-0.0.0.tgz'); if (existsSync(tarball)) add(label + '/package.tgz', tarball);
}
collect(fixedPath, 'fixed-01'); add('fixed-01/package.tgz', join(fixed.output, fixed.pack.filename));
collect(join(repo, 'src/commands/html-to-markdown/node_modules/development/verify'), 'development-verify');
for (const entry of readdirSync(own)) if (/\.(?:log|tap\.data)$/u.test(entry) || entry === 'RELOCATION.json') add('development/' + entry, join(own, entry));
const summary = {
  scope: 'author-only HTML module closure; no public/default integration or independent acceptance',
  sealedAt: new Date().toISOString(), baseline: baseline.revision, candidate: fixed.revision,
  candidateTree: fixed.tree, candidateSourceTree: fixed.sourceTree, candidateHtmlTree: fixed.htmlTree,
  baselineHtmlTree: baseline.htmlTree, candidateRegularFiles: fixed.regular.length,
  excludedNonregularGitEntries: fixed.excludedNonregularGitEntries,
  baselineCounts: baseline.counts, fixedCounts: fixed.counts,
  originalNeighbors: { source: { baselineFail: 7, baselinePass: 3, fixedPass: 10 }, moved: { baselineFail: 7, baselinePass: 3, fixedPass: 10 } },
  phases, allFixedReceipts: fixed.rows.length, productLoadRecords: fixed.rows.flatMap(row => row.loads).filter(load => load.url.includes('/dist/')).length,
  noForcedTermination: true, allProcessGroupsGoneAtReceipt: true, aborts: aborts.map(row => ({ phase: row.phase, id: row.id, pid: row.pid, deadlineMs: row.deadlineMs, ...row.result.actual })),
  oldTimerObservations: fixed.rows.filter(row => row.id === 'old-timer-observation' || row.id === 'abort-100').map(row => ({ phase: row.phase, id: row.id, result: row.result })),
  frozenAuthorTests: { count: 154, unchanged: originalNames }, newTests: 52,
  packageSHA256: fixed.packageSHA256, baselinePackageSHA256: baseline.packageSHA256,
  compiledEntrySHA256: fixed.emittedBefore['dist/' + entry], movedEntrySHA256: fixed.movedBefore['dist/' + entry],
  lockSHA256: fixed.lockSHA256, node: fixed.node, compiler: fixed.compiler, pandoc: fixed.pandoc, authenticatedTools,
  sourcePathDiffBetweenFullCandidates: sourceDiff.split('\n'), ownedSourcePathDiff: git('diff', '--name-only', baseline.revision, fixed.revision, '--', 'src/commands/html-to-markdown').split('\n'),
  emittedDiff, retainedArchives,
  capturedDataClassification: 'Encoded evidence file map; executable archived candidates retained under the owned HTML module node_modules tree outside tests discovery. No shared exclusions or native fixture bytes changed.',
  limitations: ['Full regular-file snapshot excludes only the explicitly recorded native symlink entries; the retained Git tar includes their metadata.', 'Module-local closure installed by actual offline npm pack/install/move; no root/public export acceptance.', 'Development taps are unfrozen diagnostics, not whole-candidate certification.', 'author22 raw exactPass is conversion success, not an exact Markdown oracle; AST characters/style nesting are checked.', 'Original 125-profile review and Pandoc HTML conversion 5/16 exact, 11 different are not rerun or rescored.', 'Only the two explicitly frozen v2 EFBIG expectations supersede old undersized-entity success assertions.', 'Baseline tar hash is post-run; baseline regular blobs/membership were verified before and after execution.', 'tsx/esbuild are lock-version checked and fully hashed; compiler/types/Node/npm/Pandoc match the prior authenticated capture byte-for-byte.', 'Timing observations are cohost-dependent, not performance comparisons or hard deadlines.'],
};
for (const path of ['EVIDENCE.json.gz.base64', 'MANIFEST.json', 'SUMMARY.json']) assert(!existsSync(join(own, path)));
const compressed = gzipSync(Buffer.from(JSON.stringify(files)), { level: 9 });
writeFileSync(join(own, 'EVIDENCE.json.gz.base64'), compressed.toString('base64') + '\n');
save(join(own, 'MANIFEST.json'), { compressedSHA256: hash(compressed), files: manifest });
save(join(own, 'SUMMARY.json'), { ...summary, evidenceCompressedSHA256: hash(compressed), archivedEvidenceFiles: Object.keys(files).length });
console.log(JSON.stringify({ candidate: fixed.revision, receipts: fixed.rows.length, aborts: aborts.length, evidenceFiles: Object.keys(files).length, compressedBytes: compressed.length }));

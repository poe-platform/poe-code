import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { cases } from './frozen-cases.mjs';

const own = dirname(fileURLToPath(import.meta.url)), repo = resolve(own, '../../..');
const capture = join(own, 'capture-01'), state = JSON.parse(readFileSync(join(capture, 'state.json')));
assert(!existsSync(join(own, 'EVIDENCE.json')), 'seal is append-only');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
function inventory(directory, prefix = '', result = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) inventory(join(directory, entry.name), relative + '/', result);
    else { assert(entry.isFile(), relative); result[relative] = hash(readFileSync(join(directory, entry.name))); }
  }
  return result;
}
const frozenNames = ['FREEZE.md', 'frozen-cases.mjs', 'frozen-protocols.json'];
const frozenHashes = {};
for (const name of frozenNames) {
  const bytes = readFileSync(join(own, name)); assert.deepEqual(bytes, git('show', `${state.freeze}:tests/commands/html-to-markdown-independent-20260827/${name}`)); frozenHashes[name] = hash(bytes);
}
for (const [objectPath, expected] of Object.entries(state.inputs)) {
  assert.equal(hash(git('show', objectPath)), expected.sha256, objectPath);
  assert.equal(git('rev-parse', objectPath).toString().trim(), expected.blob);
}
assert.deepEqual(inventory(state.installed), state.installedBefore);
const expectedRetired = { ...state.sourceBefore, ...Object.fromEntries(Object.entries(state.emittedBefore).map(([name, digest]) => ['dist/' + name, digest])), [state.pack[0].filename]: state.tarballSha256 };
assert.deepEqual(inventory(state.retiredBuild), expectedRetired, 'retired source/output tree including additions');
for (const [name, expected] of Object.entries(state.toolchain.packages)) assert.deepEqual(inventory(join(state.tools, 'node_modules', name)), expected.files);
assert.equal(hash(readFileSync(process.execPath)), state.toolchain.node.sha256);
const executed = join(capture, 'executed-harness-snapshots'); mkdirSync(executed);
for (const name of readdirSync(state.consumer).filter(name => name.startsWith('harness-'))) cpSync(join(state.consumer, name), join(executed, name), { recursive: true });
if (existsSync('/tmp/html-independent-frozen-progress.log')) { cpSync('/tmp/html-independent-frozen-progress.log', join(capture, 'frozen-progress.log')); rmSync('/tmp/html-independent-frozen-progress.log'); }
const npmCli = realpathSync(join(dirname(process.execPath), 'npm'));
const npmManifest = JSON.parse(readFileSync(join(dirname(npmCli), '../package.json')));
const final = { time: new Date().toISOString(), frozenHashes, exactCandidateInputsReverified: Object.keys(state.inputs).length, installedUnchangedIncludingNewEntries: true, retiredSourceAndEmittedUnchangedIncludingNewEntries: true, copiedDevelopmentToolsUnchanged: true, npmToolIdentityPostRun: { path: npmCli, sha256: hash(readFileSync(npmCli)), version: npmManifest.version, qualification: 'post-run identity; no pre-run npm CLI hash was captured' }, foreignStatus: git('status', '--porcelain=v1', '--', '.', ':(exclude)tests/commands/html-to-markdown-independent-20260827').toString(), foreignStaging: git('diff', '--cached', '--raw', '--', '.', ':(exclude)tests/commands/html-to-markdown-independent-20260827').toString() };
const originalRows = JSON.parse(readFileSync(join(capture, 'frozen/receipts.json')));
const corrections = JSON.parse(readFileSync(join(capture, 'corrections-v2/receipts.json')));
const controls = JSON.parse(readFileSync(join(capture, 'controls/receipts.json')));
const protocols = JSON.parse(readFileSync(join(own, 'frozen-protocols.json')));
const matrix = [...cases.map(test => ({ id: test.id, kind: test.kind, expected: test.kind === 'literal' ? test.expected : test.rule ?? { status: test.status, limits: test.limits }, inputSha256: hash(test.bytes ? Uint8Array.from(test.bytes) : test.input ?? ''), original: originalRows.find(row => row.id === test.id)?.outcome ?? 'NOTEXECUTED', actual: originalRows.find(row => row.id === test.id)?.result?.actual, observationOnly: test.rule === 'record-destination-ambiguity', correction: corrections.find(row => row.id === test.id + '-v2')?.outcome })), ...protocols.map(test => ({ ...test, original: originalRows.find(row => row.id === test.id)?.outcome ?? (test.id.startsWith('N') ? 'SEE_CONTROL_ROWS' : 'NOTEXECUTED'), controls: controls.filter(row => row.id.startsWith(test.id.split('-')[0])).map(({ id, outcome }) => ({ id, outcome })), correction: corrections.find(row => row.id === test.id + '-v2')?.outcome }))];
writeFileSync(join(own, 'CASE-MATRIX.json'), JSON.stringify({ freeze: state.freeze, rows: matrix, counts: { fixedInputRows: cases.length, frozenProtocolDefinitions: protocols.length, firstRunExecuted: originalRows.length, urlObservationRows: matrix.filter(row => row.observationOnly).length } }, null, 2) + '\n');
const authorMeta = JSON.parse(git('show', `${state.evidence}:tests/commands/html-to-markdown/evidence/CAPTURES.json`));
const authorArchive = JSON.parse(gunzipSync(Buffer.from(git('show', `${state.evidence}:tests/commands/html-to-markdown/evidence/CAPTURES.json.gz.base64`).toString(), 'base64')));
const compiled = JSON.parse(Buffer.from(authorArchive['compiled-final/REPORT.json'], 'base64'));
for (const [name, expected] of Object.entries({ ...authorMeta.sourceFiles, ...compiled.sourceInputs })) assert.equal(hash(git('show', state.candidate + ':' + name)), expected);
final.authorHistoricalCompiledInputsAuthenticated = Object.keys(compiled.sourceInputs).length;
final.authorHistoricalTAP119Verified = /# tests 119\n# suites 0\n# pass 119\n# fail 0\n# cancelled 0\n# skipped 0/u.test(Buffer.from(authorArchive['author-07.tap'], 'base64').toString());
assert(final.authorHistoricalTAP119Verified);
final.processGroups = [];
for (const directory of readdirSync(capture)) {
  const filename = join(capture, directory, 'receipts.json'); if (!existsSync(filename)) continue;
  const rows = JSON.parse(readFileSync(filename));
  for (const row of rows) { assert(row.processGroupGone, row.id); final.processGroups.push({ phase: directory, id: row.id, pid: row.pid, killed: row.killed, goneAtReceipt: row.processGroupGone }); }
}
rmSync(state.scratch, { recursive: true }); assert(!existsSync(state.scratch)); final.scratchRemovedAfterAuthenticationAndSnapshots = true;
writeFileSync(join(capture, 'final-integrity.json'), JSON.stringify(final, null, 2) + '\n');
const rawFiles = inventory(capture), fileMap = {}, files = [];
for (const [relative, sha256] of Object.entries(rawFiles)) {
  const bytes = readFileSync(join(capture, relative)); const name = 'capture-01/' + relative;
  fileMap[name] = bytes.toString('base64'); files.push({ path: name, bytes: bytes.length, sha256 });
}
const archive = gzipSync(Buffer.from(JSON.stringify(fileMap)), { level: 9 });
const archiveName = 'EVIDENCE.json.gz.base64'; writeFileSync(join(own, archiveName), archive.toString('base64') + '\n');
const decoded = JSON.parse(gunzipSync(archive));
for (const file of files) assert.equal(hash(Buffer.from(decoded[file.path], 'base64')), file.sha256);
const metadata = { format: 'base64-file-map-gzip-v1', candidate: state.candidate, supplemental: state.supplemental, evidence: state.evidence, freeze: state.freeze, sealed: new Date().toISOString(), archiveName, archiveSha256: hash(archive), frozenHashes, files, artifactClassification: 'Immutable version-specific review evidence; native data/outputs and generated fixture snapshots are not canonical TypeScript source or discovery inputs.', rawFilesRemainAvailableLosslesslyInArchive: true };
writeFileSync(join(own, 'EVIDENCE.json'), JSON.stringify(metadata, null, 2) + '\n');
rmSync(capture, { recursive: true });
console.log(JSON.stringify({ sealedFiles: files.length, archiveBytes: archive.length, archiveSha256: metadata.archiveSha256, frozenUnchanged: true, scratchRemoved: true, processReceipts: final.processGroups.length, matrixRows: matrix.length }));

import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const [rootArgument] = process.argv.slice(2);
assert(rootArgument && process.argv.length === 3);
const own = fs.realpathSync(rootArgument), parent = path.dirname(own), repo = path.resolve(parent, '../../..'), output = path.join(own, 'output');
assert(own.endsWith('/tests/compatibility/bash-ere-core-transport-rebind-20260829/author-v3'));
assert(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile());
function read(filename) { const before = fs.lstatSync(filename); assert(before.isFile() && before.size <= 16777216); const bytes = fs.readFileSync(filename), after = fs.lstatSync(filename); assert.equal(bytes.length, before.size); assert.equal(before.ino, after.ino); assert.equal(before.mtimeMs, after.mtimeMs); return bytes; }
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function row(filename, base = own) { const bytes = read(filename); return { path: path.relative(base, filename), size: bytes.length, mode: fs.lstatSync(filename).mode & 511, sha256: sha(bytes) }; }
function inventory(base) { const rows = []; function walk(directory) { for (const name of fs.readdirSync(directory).sort()) { const filename = path.join(directory, name), stat = fs.lstatSync(filename); if (stat.isDirectory()) walk(filename); else rows.push(row(filename, base)); } } walk(base); return { rows, files: rows.length, bytes: rows.reduce((sum, item) => sum + item.size, 0), maximumFileBytes: Math.max(0, ...rows.map(item => item.size)) }; }
function json(name, value) { const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); assert(bytes.length <= 16777216); fs.writeFileSync(path.join(own, name), bytes, { flag: 'wx', mode: 0o444 }); }
assert(read(path.join(own, 'producer-index-before.raw')).equals(read(path.join(own, 'producer-index-after.raw'))), 'producer publication foreign staging');
const finalBytes = read(path.join(output, 'FINAL-BINDINGS.json'));
assert.equal(sha(finalBytes), '470b39c48b72d618189611c95ff1cc8b04efbd69b2aab3533f3052df504f788c');
const final = JSON.parse(finalBytes), guard = JSON.parse(read(final.guardPreseal.path));
assert.equal(sha(read(final.guardPreseal.path)), 'e832b9cf2342c99d09a785f801ae4c73f5905a3d349c9efbc2818e6955c1f66e');
assert.equal(final.producerCommit, 'b8e181757058ff51c32e00387abc730cd1acc29c');
const producerBytes = read(path.join(output, 'PRE-INFLATE-RECEIPT.json'));
assert.equal(sha(producerBytes), '52b75de5a8b9af27effc7d5dcf5ffa64eeb8171383413810709143b144fef54d');
const producer = JSON.parse(producerBytes);
assert.equal(sha(read(producer.archive.path)), producer.archive.sha256); assert.equal(fs.lstatSync(producer.archive.path).mode & 0o222, 0);
for (const child of producer.receipts) assert(child.retired && child.close.code === 0 && child.stdoutEOF && child.stderrEOF);
const barrier = JSON.parse(read(path.join(output, 'commit-barrier.json'))); assert(barrier.retired && barrier.close.code === 0);
const composition = JSON.parse(read(path.join(parent, 'COMPOSITION.json')));
for (const source of composition.sources) assert.equal(sha(read(path.join(output, 'source', source.path))), source.sha256);
const types = JSON.parse(read(path.join(own, 'TYPE-TOOLS.json')));
for (const entry of types.rows) { assert.equal(sha(read(entry.path)), entry.sha256); assert.equal(sha(read(entry.origin)), entry.sha256); }
assert.equal(sha(read(path.join(parent, 'author-v2/FAILURE-RECEIPT.json'))), '7f4c3dfd8c150d9399e8291297325e211ecd30386b54bdb673e915cf2e46e984');
assert.equal(sha(read(path.join(parent, 'PRESEAL.json'))), '02c98960983bfeffabf43ba11d5a594c498623c2befe3a06136c12d99d2dfd17');
const layouts = [];
for (const layout of final.layouts) {
  const saved = JSON.parse(read(layout.manifest.path)), actual = inventory(layout.app);
  assert.equal(actual.files, saved.rows.length); assert.equal(actual.bytes, saved.bytes);
  const expected = new Map(saved.rows.map(item => [item.path, item]));
  for (const actualRow of actual.rows) { const entry = expected.get(actualRow.path); assert(entry); for (const key of ['size', 'mode', 'sha256']) assert.equal(actualRow[key], entry[key]); }
  layouts.push({ name: layout.name, app: layout.app, manifest: row(layout.manifest.path), files: actual.files, bytes: actual.bytes, productTreeFiles: layout.packageMembers, privateAssets: layout.privateAssets, physicalMove: layout.physicalMove });
}
assert.equal(final.definitionCount, 70); assert.equal(final.layoutCells, 210); assert.equal(guard.actualRuntimeAuthority, false);
assert.equal(guard.futureCaps.totalMilliseconds, 1800000); assert.equal(guard.futureCaps.publicationMilliseconds, 180000);
const emit = JSON.parse(read(path.join(output, 'FULL-EMIT-DIFF.json'))), causes = JSON.parse(read(path.join(output, 'EMIT-CAUSES.json')));
assert.equal(causes.rows.length, 18); assert.equal(causes.foreign.length, 0); assert.deepEqual(emit.counts, { unchanged: 992, changed: 8, added: 0, removed: 0 });
const retained = inventory(own); json('RETAINED-DATA.json', { at: new Date().toISOString(), root: own, excludesOwnSnapshotAndLaterPublication: true, ...retained });
const allOwned = inventory(parent), captureBytes = allOwned.rows.filter(item => /\.(stdout|stderr|log|raw)$/.test(item.path)).reduce((sum, item) => sum + item.size, 0), publicationReserve = 33554432;
assert(allOwned.bytes + publicationReserve <= 536870912); assert(captureBytes + publicationReserve <= 100663296);
const receipt = { schema: 'CORE_CORRECTED_ROOT_AUTHOR_DATA_PUBLICATION_V3', at: new Date().toISOString(), verdict: 'AUTHOR_BUILD_PACKAGE_AND_FINITE_DATA_COMPLETE_PENDING_INDEPENDENT_AUDIT', producerCommit: final.producerCommit, producerReceipt: row(path.join(output, 'PRE-INFLATE-RECEIPT.json')), archive: producer.archive, sourceComposition: composition.derivedTree, sourceSelection: { inputs: 305, unchanged: 303, overlays: 2 }, tools: { nodeTypes: types.packages, files: types.fileCount, bytes: types.bytes, allOriginalPinsReauthenticated: true, compiler: JSON.parse(read(path.join(repo, 'node_modules/typescript/package.json'))).version, typeManifest: row(path.join(own, 'TYPE-TOOLS.json')) }, compiler: producer.receipts.find(child => child.id === 'strict-build'), pack: producer.receipts.find(child => child.id === 'offline-pack'), commitBarrier: barrier, compilerAttemptsThisGrant: 1, compilerAttemptsIncludingPreservedV2Failure: 2, packAttempts: 1, decodeInvocations: 1, emitCounts: emit.counts, changedPaths: emit.rows.filter(item => item.status !== 'unchanged').map(item => item.path), failedEmitCausePaths: causes.rows.length, resolvedFailedOnlyDifferences: causes.rows.filter(item => item.qualifiedStatus === 'unchanged').length, shippingMembers: final.shippingMembers, privateAssets: final.privateAssets, literalStaticEdges: final.literalStaticEdges, layouts, definitions: 70, cells: 210, guardPreseal: final.guardPreseal, finalBindings: row(path.join(output, 'FINAL-BINDINGS.json')), futureLogicalBound: final.logicalBound, currentResources: { knownStartsThroughThisCensus: 29, plannedRemainingPublicationStarts: 7, conditionalFinalKnownStarts: 36, maximumKnownStarts: 48, conservativePeak: 3, maximumPeak: 3, allOwnedFileCount: allOwned.files, allOwnedLogicalBytes: allOwned.bytes, captureBytes, publicationReserveBytes: publicationReserve, logicalBoundIncludingPublication: allOwned.bytes + publicationReserve, maximumWork: 536870912, maximumCapture: 100663296, perDataFileMaximum: 16777216, exclusions: ['Git internal physical storage', 'allocated disk blocks', 'RSS'], deadline: '2026-08-29T16:23:05Z', retirementQualification: 'Compiler, pack and Git children exit/close/both EOF observed; administrative closure from completed tool calls, current/final publication helpers pending their direct completion' }, actualRuntimeAuthority: false, product: 0, Workers: 0, Shell: 0, nativeOracles: 0, installs: 0, independentProducerReview: null, priorFailurePreserved: '58ba544b0c702ff47ff7b623f05afb1229ffe3ca' };
json('PUBLICATION-RECEIPT.json', receipt);
const publish = fs.readdirSync(own).filter(name => fs.lstatSync(path.join(own, name)).isFile()).map(name => path.join(own, name));
for (const name of fs.readdirSync(output)) if (fs.lstatSync(path.join(output, name)).isFile()) publish.push(path.join(output, name));
for (const entry of inventory(path.join(output, 'controller')).rows) publish.push(path.join(output, 'controller', entry.path));
for (const layout of final.layouts) { publish.push(layout.manifest.path); for (const entry of JSON.parse(read(layout.manifest.path)).rows) if (entry.path.startsWith('cells/') || entry.path.startsWith('harness/')) publish.push(path.join(layout.app, entry.path)); }
publish.push(path.join(own, 'FINAL-PUBLICATION-PATHS.txt'));
fs.writeFileSync(path.join(own, 'FINAL-PUBLICATION-PATHS.txt'), [...new Set(publish)].map(filename => path.relative(repo, filename)).sort().join('\n') + '\n', { flag: 'wx' });
console.log(JSON.stringify({ receipt: row(path.join(own, 'PUBLICATION-RECEIPT.json')), layouts, resources: receipt.currentResources, changedPaths: receipt.changedPaths, publishFiles: new Set(publish).size }));

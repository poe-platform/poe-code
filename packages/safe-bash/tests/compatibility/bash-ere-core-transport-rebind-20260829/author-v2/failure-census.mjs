import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const [rootArgument] = process.argv.slice(2);
assert(rootArgument && process.argv.length === 3);
const root = fs.realpathSync(rootArgument), parent = path.dirname(root), repo = path.resolve(parent, '../../..');
assert(root.endsWith('/tests/compatibility/bash-ere-core-transport-rebind-20260829/author-v2'));
assert(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile());
const maximumFile = 16777216, maximumWork = 536870912;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename) {
  const before = fs.lstatSync(filename);
  assert(before.isFile() && before.size <= maximumFile);
  const bytes = fs.readFileSync(filename), after = fs.lstatSync(filename);
  assert.equal(bytes.length, before.size); assert.equal(before.ino, after.ino); assert.equal(before.mtimeMs, after.mtimeMs);
  return bytes;
}
function row(filename, base) {
  const bytes = read(filename);
  return { path: path.relative(base, filename), size: bytes.length, mode: fs.lstatSync(filename).mode & 511, sha256: sha(bytes) };
}
function inventory(base) {
  const rows = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, name), stat = fs.lstatSync(filename);
      if (stat.isDirectory()) walk(filename); else rows.push(row(filename, base));
    }
  }
  walk(base);
  return { rows, files: rows.length, bytes: rows.reduce((sum, item) => sum + item.size, 0), maximumFileBytes: Math.max(0, ...rows.map(item => item.size)) };
}
function json(filename, data) {
  const bytes = Buffer.from(JSON.stringify(data, null, 2) + '\n');
  assert(bytes.length <= maximumFile);
  fs.writeFileSync(path.join(root, filename), bytes, { flag: 'wx', mode: 0o444 });
}
const preseal = read(path.join(root, 'PRESEAL.json'));
assert.equal(sha(preseal), 'c0ac00138f379f36a7fabb447ccda25a16788006942ee01f893b67088d3ca5c4');
const oldSeal = read(path.join(parent, 'PRESEAL.json'));
assert.equal(sha(oldSeal), '02c98960983bfeffabf43ba11d5a594c498623c2befe3a06136c12d99d2dfd17');
for (const item of JSON.parse(oldSeal).files) assert.equal(sha(read(path.join(parent, item.path))), item.sha256);
const composition = JSON.parse(read(path.join(parent, 'COMPOSITION.json')));
const sourceRoot = path.join(root, 'output/source');
for (const item of composition.sources) {
  const bytes = read(path.join(sourceRoot, item.path));
  assert.equal(bytes.length, item.bytes); assert.equal(sha(bytes), item.sha256);
}
const compiler = JSON.parse(read(path.join(root, 'output/strict-build.json')));
const git = JSON.parse(read(path.join(root, 'output/source-blobs.json')));
assert.equal(compiler.close.code, 2); assert(compiler.retired && git.retired);
assert.equal(sha(read(path.join(root, 'output/strict-build.stdout'))), '22d754e33e5e414d820e237c9e477c81ec8db495c45ab51f7665351a89a3c783');
const compiled = inventory(sourceRoot);
const baselineRaw = read(composition.compiledManifest.path);
assert.equal(sha(baselineRaw), composition.compiledManifest.sha256);
const before = new Map(JSON.parse(baselineRaw).rows.filter(item => item.path.startsWith('dist/')).map(item => [item.path, item]));
const after = new Map(compiled.rows.filter(item => item.path.startsWith('dist/')).map(item => [item.path, item]));
const emit = [...new Set([...before.keys(), ...after.keys()])].sort().map(filename => {
  const original = before.get(filename), current = after.get(filename);
  return { path: filename, kind: filename.endsWith('.d.ts.map') ? 'declaration-map' : filename.endsWith('.d.ts') ? 'declaration' : filename.endsWith('.map') ? 'source-map' : 'javascript-or-other', status: !original ? 'added' : !current ? 'removed' : original.sha256 === current.sha256 && (original.bytes ?? original.size) === current.size ? 'unchanged' : 'changed', before: original ?? null, after: current ?? null };
});
const counts = Object.fromEntries(['unchanged', 'changed', 'added', 'removed'].map(status => [status, emit.filter(item => item.status === status).length]));
json('FAILED-EMIT-DIFF.json', { qualification: 'COMPILER_EXIT_2_NOT_SHIPPING', baseline: composition.baseDerivedTree, composition: composition.derivedTree, emittedFiles: after.size, counts, rows: emit });
json('FAILED-SOURCE-AND-EMIT-INVENTORY.json', compiled);
const retained = inventory(root);
json('RETAINED-INVENTORY.json', { at: new Date().toISOString(), root, excludesOwnSnapshotAndLaterPublication: true, ...retained });
const allOwned = inventory(parent);
const capture = allOwned.rows.filter(item => /\.(stdout|stderr|log)$/.test(item.path)).reduce((sum, item) => sum + item.size, 0);
const publicationReserve = 33554432;
assert(allOwned.bytes + publicationReserve <= maximumWork);
assert(capture + publicationReserve <= 100663296);
const receipt = {
  schema: 'CORE_ROOT_AUTHOR_BUILD_V2_FAILURE', at: new Date().toISOString(), verdict: 'HOLD', reason: 'TS2688: selected tsconfig requires node typings but sealed compiler command uses empty typeRoots',
  authorizationKind: 'ROOT_SOURCE_ACCEPTED_AUTHOR_BUILD', independentProducerReview: null,
  composition: composition.derivedTree, selectedInputs: 305, unchanged: 303, overlays: 2, sourcePostcheck: '305/305 unchanged',
  sourceCommit: '4abbdeec8e34de88ed2cf7bd32be9c06b413c631', sourcePureReview: 'f17d8dec11190ef40ecac6c175b208a2e29c7fbf',
  presealSha256: sha(preseal), compilerAttempts: 1, compilerExit: 2, retries: 0, packAttempts: 0, archiveDecodes: 0, materializedLayouts: 0, product: 0, Workers: 0, nativeOracles: 0, installs: 0, network: 0,
  contract: JSON.parse(read(path.join(root, 'CONTRACT-RESULT.json'))), childReceipts: [git, compiler], failedEmitCounts: counts, failedEmitFiles: after.size,
  evidence: ['PRESEAL.json', 'BUILD-GRANT.json', 'ROOT-DECISION.txt', 'STOP-build.json', 'output/strict-build.json', 'output/strict-build.stdout', 'output/strict-build.stderr', 'output/SOURCE-ADMISSION.json', 'output/TOOL-ADMISSION.json', 'FAILED-EMIT-DIFF.json', 'FAILED-SOURCE-AND-EMIT-INVENTORY.json', 'RETAINED-INVENTORY.json'].map(name => row(path.join(root, name), root)),
  resources: { knownStartsThroughThisCensus: 28, remainingPublicationKnownStarts: 7, conditionalFinalKnownStarts: 35, allowedKnownStarts: 56, conservativePeak: 3, allowedPeak: 3, childRetirement: 'Git and compiler exit/close/both EOF observed', administrativeRetirement: 'Direct tool completions; shell/helper exit established after receipt, not fabricated per-PID census', measuredAllOwnedFiles: allOwned.files, measuredAllOwnedBytes: allOwned.bytes, measuredCaptureBytes: capture, publicationReserveBytes: publicationReserve, logicalBoundIncludingPublication: allOwned.bytes + publicationReserve, workMaximum: maximumWork, captureMaximum: 100663296, perDataFileMaximum: maximumFile, exclusions: ['Git internal physical storage', 'allocated disk blocks', 'RSS'], deadline: '2026-08-29T16:08:17Z' },
  caveats: ['No qualified package or CORE guard/layout rebind', 'Failed compiler emits retained as DATA only', 'Prior c73b STOP and old seals immutable', 'B35 finite DATA ACCEPT and review peak4/3 HOLD unchanged', 'Actual private T1 pending', 'One administrative unmatched-glob failure retained; no child launched']
};
json('FAILURE-RECEIPT.json', receipt);
const selected = fs.readdirSync(root).filter(name => fs.lstatSync(path.join(root, name)).isFile() && !['census.stdout', 'census.stderr'].includes(name)).map(name => path.join(root, name));
for (const name of fs.readdirSync(path.join(root, 'output'))) if (fs.lstatSync(path.join(root, 'output', name)).isFile()) selected.push(path.join(root, 'output', name));
selected.push(path.join(root, 'census.stdout'), path.join(root, 'census.stderr'), path.join(root, 'PUBLICATION-PATHS.txt'));
fs.writeFileSync(path.join(root, 'PUBLICATION-PATHS.txt'), selected.map(filename => path.relative(repo, filename)).sort().join('\n') + '\n', { flag: 'wx' });
console.log(JSON.stringify({ receipt: row(path.join(root, 'FAILURE-RECEIPT.json'), repo), counts, failedEmittedFiles: after.size, resources: receipt.resources, publicationFiles: selected.length }));

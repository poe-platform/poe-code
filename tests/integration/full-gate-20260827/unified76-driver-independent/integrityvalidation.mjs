import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../..');
const blobLimit = 524288;
const timeoutMs = 15000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const membershipHash = paths => sha256([...paths].sort().join('\n') + '\n');

function git(...args) {
  return execFileSync('git', args, { cwd: repository, maxBuffer: blobLimit, timeout: timeoutMs });
}

function readBlob(revision, path) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  assert(!path.startsWith('/') && !path.split('/').includes('..'));
  const identity = `${revision}:${path}`;
  assert(Number(git('cat-file', '-s', identity).toString()) <= blobLimit);
  return git('cat-file', 'blob', identity);
}

function readOwned(name) {
  const path = resolve(directory, name);
  const stat = lstatSync(path);
  assert(stat.isFile() && stat.size <= blobLimit);
  return readFileSync(path);
}

async function treeMembership(revision, retainedPaths) {
  const child = spawn('git', ['ls-tree', '-r', '-z', revision], {
    cwd: repository, stdio: ['ignore', 'pipe', 'pipe']
  });
  let childError;
  child.on('error', error => { childError = error; });
  const settled = new Promise(resolveStatus => child.on('close', (code, signal) => resolveStatus({ code, signal })));
  const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  let stderrBytes = 0;
  child.stderr.on('data', chunk => {
    stderrBytes += chunk.length;
    if (stderrBytes > blobLimit) child.kill('SIGTERM');
  });
  child.stdout.setEncoding('utf8');
  let pending = '';
  let metadataBytes = 0;
  let entries = 0;
  const selected = new Map();
  const canonical = [];
  const mts = [];
  try {
    for await (const chunk of child.stdout) {
      metadataBytes += Buffer.byteLength(chunk);
      assert(metadataBytes <= 16777216);
      pending += chunk;
      const records = pending.split('\0');
      pending = records.pop();
      assert(pending.length <= 8192);
      for (const record of records) {
        assert(record.length <= 8192);
        const separator = record.indexOf('\t');
        assert(separator > 0);
        const [mode, type, blob] = record.slice(0, separator).split(' ');
        const path = record.slice(separator + 1);
        entries += 1;
        if (path.endsWith('.test.ts')) canonical.push({ path, blob });
        if (path.endsWith('.mts')) mts.push(path);
        if (retainedPaths.has(path) || path.endsWith('.test.ts') || path.endsWith('.mts')) {
          assert(!selected.has(path));
          selected.set(path, { mode, type, blob });
        }
      }
    }
    const result = await settled;
    if (childError) throw childError;
    assert.deepEqual(result, { code: 0, signal: null });
    assert.equal(stderrBytes, 0);
    assert.equal(pending, '');
    return { selected, canonical, mts, entries, metadataBytes };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await settled;
  }
}

export async function verifyPreparation() {
  assert.equal(git('rev-parse', '--show-toplevel').toString().trim(), repository);
  const phaseABytes = readOwned('PHASE-A.json');
  const phaseA = JSON.parse(phaseABytes);
  const phaseBBytes = readOwned('PHASE-B.json');
  const phaseB = JSON.parse(phaseBBytes);
  assert.equal(phaseB.schema, 'unified76-independent-preparation/phase-b/v1');
  assert.equal(phaseB.phaseA.sha256, 'c8df466748a048e91a7a28a0b83c58dca2f8fdba2773e359d7b647d51d41a37c');
  assert.equal(sha256(phaseABytes), phaseB.phaseA.sha256);
  assert.deepEqual(readBlob(phaseB.phaseA.commit, phaseB.phaseA.path), phaseABytes);
  for (const phase of [phaseA, phaseB]) {
    assert.equal(phase.status, 'PRE-CANDIDATE/HOLD');
    assert.equal(phase.controlsStatus, 'NOT_EXECUTED');
  }
  assert.deepEqual(phaseA.controls.map(control => control.id), Array.from({ length: 22 }, (_, index) => `A${String(index + 1).padStart(2, '0')}`));
  for (const control of phaseA.controls) {
    assert(control.stage && control.positive.mutation && control.positive.verdict && control.negative.length);
    for (const negative of control.negative) assert(negative.mutation && negative.verdict);
  }
  assert.equal(phaseB.questions.length, 7);
  assert.equal(new Set(phaseB.questions.map(question => question.id)).size, 7);
  const controlIds = new Set(phaseA.controls.map(control => control.id));
  for (const question of phaseB.questions) for (const id of question.controls) assert(controlIds.has(id));
  assert.deepEqual(phaseA.chronology.bodyExposure, []);
  assert.deepEqual(phaseB.chronology.liveAuthorBodiesRead, []);
  const sources = new Map();
  for (const entry of phaseB.evidence) {
    assert(!sources.has(entry.id));
    const bytes = readBlob(phaseB.revisions[entry.revision], entry.path);
    assert.equal(sha256(bytes), entry.sha256, entry.path);
    sources.set(entry.id, entry.path.endsWith('.json') ? JSON.parse(bytes) : bytes.toString());
  }
  const receipt = sources.get('proposalReceipt');
  const inventory = sources.get('mts');
  const native = sources.get('native');
  const known = phaseB.knownBindings;
  const base = phaseB.revisions.base;
  assert.equal(base, phaseA.bindings.productBaseCommit);
  assert.equal(receipt.candidate, base);
  assert.equal(git('rev-parse', `${base}^{tree}`).toString().trim(), known.productTree);
  assert.equal(git('rev-parse', `${base}:src`).toString().trim(), known.sourceTree);
  assert.equal(receipt.package.tarballSha256, known.productPackSha256);
  assert.equal(receipt.package.metadataSha256, known.packageJsonSha256);
  assert.equal(sha256(readBlob(base, 'package.json')), known.packageJsonSha256);
  assert.equal(phaseB.fixtures.length, 4);
  assert.equal(new Set(phaseB.fixtures.map(fixture => fixture.path)).size, 4);
  assert.deepEqual(phaseB.fixtures.map(({ from, to }) => [from, to]), [[73,76],[73,76],[74,77],[70,76]]);
  const cleanupPaths = Object.keys(receipt.cleanup.files);
  const retained = new Set([...cleanupPaths, ...phaseB.fixtures.map(fixture => fixture.path)]);
  const tree = await treeMembership(base, retained);
  assert.equal(tree.entries, known.fullGitTree.entries);
  assert.deepEqual(tree.canonical, receipt.canonical.paths);
  assert.equal(tree.canonical.length, known.canonical.count);
  assert.equal(membershipHash(tree.canonical.map(entry => entry.path)), known.canonical.membershipSha256);
  const classifiedPaths = inventory.entries.map(entry => entry.path);
  assert.equal(new Set(classifiedPaths).size, known.classifiedMts.count);
  assert.deepEqual([...tree.mts].sort(), [...classifiedPaths].sort());
  assert.equal(membershipHash(classifiedPaths), known.classifiedMts.membershipSha256);
  const classCounts = {};
  const bindingFindings = [];
  for (const entry of inventory.entries) {
    classCounts[entry.classification] = (classCounts[entry.classification] ?? 0) + 1;
    const actualSha256 = sha256(readBlob(base, entry.path));
    if (actualSha256 !== entry.sha256) bindingFindings.push({
      path: entry.path, classification: entry.classification,
      inventorySha256: entry.sha256, baseSha256: actualSha256
    });
  }
  assert.deepEqual(classCounts, known.classifiedMts.counts);
  assert.equal(sources.get('stagedTypes').entries.length, 14);
  for (const entry of sources.get('stagedTypes').entries) assert.equal(sha256(readBlob(base, entry.path)), entry.sha256, entry.path);
  assert.equal(cleanupPaths.length, known.cleanup.count);
  assert.equal(membershipHash(cleanupPaths), known.cleanup.membershipSha256);
  assert.equal(receipt.cleanup.sha256, known.cleanup.draftEnvelopeSha256Reported);
  assert.equal(receipt.cleanup.oldCount, 244);
  assert.equal(receipt.cleanup.added.length, 12);
  assert.equal(receipt.cleanup.removed.length, 0);
  assert.equal(Object.keys(receipt.cleanup.changed).length, 23);
  for (const path of cleanupPaths) assert.equal(sha256(readBlob(base, path)), receipt.cleanup.files[path], path);
  for (const fixture of phaseB.fixtures) {
    assert.equal(fixture.candidateSha256, null);
    assert.equal(tree.selected.get(fixture.path).blob, fixture.baseBlob);
    assert.equal(sha256(readBlob(base, fixture.path)), fixture.baseSha256, fixture.path);
  }
  for (const entry of tree.selected.values()) {
    assert.equal(entry.type, 'blob');
    assert(['100644', '100755'].includes(entry.mode));
  }
  assert.equal(native.candidate, base);
  assert.equal(native.baseRequirements, 49);
  assert.equal(native.assets.length, 51);
  assert.deepEqual(native.assets.slice(49).map(entry => entry.name), ['expr', 'du']);
  assert.equal(native.assets.filter(entry => entry.executable).length, 44);
  for (const asset of native.assets) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.equal(asset.actualSha256, asset.sha256);
  }
  assert.deepEqual(sources.get('historicalCases').cases.filter(entry => entry.group === 'binding').map(entry => entry.id), phaseB.historicalVersioning.sevenUnexecutedIds);
  assert.equal(sources.get('historicalBoundary').defaultNames.length, 73);
  assert.equal(known.runtimeClosure, null);
  return {
    status: bindingFindings.length ? 'STATIC_BINDING_FINDINGS_HOLD' : 'STATIC_PREPARATION_VALIDATED_ONLY', candidateStatus: phaseB.status,
    controlsStatus: phaseB.controlsStatus, driverInspected: false,
    staticToolNode: process.version, bindingFindings,
    phaseASha256: sha256(phaseABytes), phaseBSha256: sha256(phaseBBytes),
    evidenceBlobs: sources.size, canonicalPathAndBlobIdentities: tree.canonical.length,
    classifiedMtsBlobsHashed: classifiedPaths.length, cleanupBlobsHashed: cleanupPaths.length, stagedTypeBlobsHashed: 14,
    baseFixtureBlobsHashed: phaseB.fixtures.length, historicalNativeManifestEntries: native.assets.length,
    gitMetadataBytes: tree.metadataBytes, archiveBytesRead: 0, runtimeExecutions: 0
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--verify') {
    console.error('Usage: node integrityvalidation.mjs --verify (read-only preparation validation; never launches gate)');
    process.exitCode = 2;
  } else {
    try {
      const result = await verifyPreparation();
      console.log(JSON.stringify(result, null, 2));
      if (result.bindingFindings.length) process.exitCode = 1;
    }
    catch (error) { console.error(error); process.exitCode = 1; }
  }
}

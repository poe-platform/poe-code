import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTree, treeHash, entryBytes, verifyProjection, objectId, sha256, batchObjects } from './path-bytes.mjs';
import { independentTree } from './independent-tree.mjs';
import { readCapture, recorder } from './capture-io.mjs';

const own = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(own, '../../../..');
const runName = process.argv[2]; assert.match(runName ?? '', /^data-[0-9]{2}$/);
const sourceCommit = process.argv[3]; assert.match(sourceCommit ?? '', /^[0-9a-f]{40}$/);
const output = path.join(own, 'runs', runName), capture = recorder(output, repository);
const results = [];
function control(id, operation) { try { operation(); results.push({ id, status: 'PASS', classification: 'DATA/SYNTHETIC' }); } catch (reason) { results.push({ id, status: 'FAIL', message: reason.message }); throw reason; } }
try {
  const preseal = JSON.parse(fs.readFileSync(path.join(own, 'PRESEAL.json')));
  const committedRaw = await capture.git('committed-input-inventory', ['ls-tree', '-rz', '--full-tree', sourceCommit, '--', path.relative(repository, own)]);
  const committed = new Map(parseTree(committedRaw).map(entry => [entry.path, entry]));
  for (const filename of ['PRESEAL.json', ...preseal.files.filter(entry => !entry.path.startsWith('../')).map(entry => entry.path)]) {
    const bytes = fs.readFileSync(path.join(own, filename)), entry = committed.get(path.relative(repository, path.join(own, filename)));
    assert.ok(entry, 'uncommitted control input'); assert.equal(entry.blob, objectId('blob', bytes)); assert.equal(entry.mode, '100644');
  }
  for (const entry of preseal.files) { const filename = path.resolve(own, entry.path), bytes = fs.readFileSync(filename); assert.equal(bytes.length, entry.bytes); assert.equal(sha256(bytes), entry.sha256); assert.equal(fs.statSync(filename).mode & 0o777, entry.mode); }
  const metadata = JSON.parse(fs.readFileSync(path.join(own, 'METADATA.json'))), expected = JSON.parse(fs.readFileSync(path.join(own, 'EXPECTED.json')));
  for (const tool of JSON.parse(fs.readFileSync(path.join(own, 'inventory-v1/TOOLS.json')))) { const bytes = fs.readFileSync(tool.path); assert.equal(bytes.length, tool.bytes); assert.equal(sha256(bytes), tool.sha256); }
  const vectors = JSON.parse(fs.readFileSync(path.join(own, 'VECTORS.json')));
  const objectBytes = Buffer.from('synthetic\0payload\n'), syntheticId = objectId('blob', objectBytes);
  const batch = Buffer.concat([Buffer.from(`${syntheticId} blob ${objectBytes.length}\n`), objectBytes, Buffer.from('\n')]);
  control('object-oid-request-positive', () => assert.ok(batchObjects(batch, [syntheticId]).get(syntheticId).payload.equals(objectBytes)));
  for (const corruption of ['truncated', 'extra', 'wrong-oid', 'duplicate-request', 'wrong-size', 'display-request']) control('object-reject-' + corruption, () => {
    let bytes = batch, requests = [syntheticId];
    if (corruption === 'truncated') bytes = batch.subarray(0, -1);
    if (corruption === 'extra') bytes = Buffer.concat([batch, Buffer.from('\n')]);
    if (corruption === 'wrong-oid') requests = ['0'.repeat(40)];
    if (corruption === 'duplicate-request') requests.push(syntheticId);
    if (corruption === 'wrong-size') bytes = Buffer.from(`${syntheticId} blob 01\nx\n`);
    if (corruption === 'display-request') requests = ['revision:a\nb'];
    assert.throws(() => batchObjects(bytes, requests));
  });
  for (const vector of vectors) control(vector.id, () => {
    const raw = Buffer.from(vector.base64, 'base64');
    if (vector.accept) {
      const records = parseTree(raw); assert.deepEqual(records.map(entry => ({ mode: entry.mode, blob: entry.blob, pathBase64: entry.pathBytes.toString('base64') })), vector.entries);
      assert.equal(treeHash(records), independentTree(records));
      const serialized = Buffer.concat(records.map(entry => Buffer.concat([Buffer.from(`${entry.mode} ${entry.type} ${entry.blob}\t`), entryBytes(entry), Buffer.from([0])])));
      assert.ok(serialized.equals(raw));
    } else assert.throws(() => treeHash(parseTree(raw)));
  });
  const candidateRaw = readCapture(path.join(own, 'inventory-v1'), 'candidate'), baseRaw = readCapture(path.join(own, 'inventory-v1'), 'base');
  const candidate = parseTree(candidateRaw), base = parseTree(baseRaw);
  control('full-census', () => { assert.equal(candidate.length, expected.candidateCount); assert.equal(base.length, expected.baseCount); });
  const actual = JSON.parse(fs.readFileSync(path.join(own, 'inventory-v1/ACTUAL98.json')));
  control('exact-98-no-filtering', () => {
    assert.equal(actual.entries.length, 98);
    const special = candidate.filter(entry => entry.pathBytes.some(byte => byte < 32 || byte >= 127 || byte === 34 || byte === 92));
    assert.deepEqual(special.map(entry => entry.pathBytes.toString('base64')), actual.entries.map(entry => entry.pathBase64));
    for (const entry of actual.entries) { const record = candidate[entry.ordinal - 1]; assert.equal(record.pathBytes.toString('base64'), entry.pathBase64); assert.equal(`${record.mode} ${record.type} ${record.blob}`, entry.header); }
  });
  const candidateTree = treeHash(candidate), independent = independentTree(candidate);
  control('independent-full-tree', () => { assert.equal(candidateTree, independent); assert.equal(independent, expected.candidateTree); });
  control('stored-commit-and-tree-authentication', () => {
    for (const [id, revision, tree] of [['candidate-commit', metadata.candidate, expected.candidateTree], ['base-commit', metadata.baseManifest.base, metadata.baseManifest.baseTree], ['evidence-commit', metadata.evidence]]) {
      const bytes = readCapture(path.join(own, 'inventory-v1'), id); assert.equal(objectId('commit', bytes), revision);
      if (tree) assert.ok(bytes.subarray(0, 46).equals(Buffer.from(`tree ${tree}\n`)));
    }
    assert.equal(objectId('tree', readCapture(path.join(own, 'inventory-v1'), 'stored-root')), candidateTree);
    assert.equal(treeHash(base), metadata.baseManifest.baseTree); assert.equal(independentTree(base), metadata.baseManifest.baseTree);
  });
  const overrides = new Map(metadata.baseManifest.inputs.filter(entry => entry.revision !== metadata.baseManifest.base).map(entry => [entry.path, entry]));
  const composed = base.map(entry => overrides.get(entry.path) ?? entry), inputs = [...metadata.baseManifest.inputs, ...metadata.sourceEntries];
  control('derived-composition-not-stored-object', () => { assert.equal(overrides.size, 5); assert.equal(treeHash(composed), expected.composedTree); assert.equal(independentTree(composed), expected.composedTree); });
  control('unchanged-selected-source-projection', () => { assert.equal(verifyProjection(inputs, base, candidate, metadata).length, expected.selectedCount); assert.equal(metadata.sourceEntries.length, 6); });
  for (const variant of ['duplicate', 'missing', 'mode', 'blob', 'instruction', 'traversal']) control('projection-reject-' + variant, () => {
    const changed = structuredClone(inputs);
    if (variant === 'duplicate') changed.push(changed[0]);
    if (variant === 'missing') changed[0].path = 'missing-source';
    if (variant === 'mode') changed[0].mode = '100755';
    if (variant === 'blob') changed[0].blob = '0'.repeat(40);
    if (variant === 'instruction') changed[0].path = 'AGENTS.md';
    if (variant === 'traversal') changed[0].path = '../escape';
    assert.throws(() => verifyProjection(changed, base, candidate, metadata));
  });
  for (const corruption of expected.captureCorruptions) control('capture-reject-' + corruption, () => {
    const directory = path.join(output, 'corruption-' + corruption); fs.mkdirSync(directory);
    const payload = Buffer.from('100644 blob ' + '1'.repeat(40) + '\ta\0'), fragment = { channel: 'stdout', offset: 0, totalBytes: payload.length, base64: payload.toString('base64'), sha256: sha256(payload) };
    const receipt = { id: 'fixture', code: 0, signal: null, fault: null, closeObserved: true, groupAbsent: true, knownChildCleanup: true, bytes: payload.length, stdoutSha256: sha256(payload), stderrSha256: sha256(Buffer.alloc(0)), fragments: [{ name: 'fixture-stdout-0.json', bytes: payload.length, sha256: sha256(payload) }] };
    if (corruption === 'hash') fragment.sha256 = '0'.repeat(64);
    if (corruption === 'offset') fragment.offset = 1;
    if (corruption === 'total') fragment.totalBytes++;
    if (corruption === 'base64') fragment.base64 += '\n';
    if (corruption === 'missing') receipt.fragments = [];
    if (corruption === 'duplicate') receipt.fragments.push(receipt.fragments[0]);
    if (corruption === 'extra-channel') receipt.fragments.push({ name: 'fixture-other-0.json' });
    if (corruption === 'exit') receipt.code = 1;
    if (corruption === 'cleanup') receipt.groupAbsent = false;
    fs.writeFileSync(path.join(directory, 'fixture.json'), JSON.stringify(receipt), { flag: 'wx' });
    fs.writeFileSync(path.join(directory, 'fixture-stdout-0.json'), JSON.stringify(fragment), { flag: 'wx' });
    assert.throws(() => readCapture(directory, 'fixture'));
  });
  const oracle = await capture.git('stored-tree-oracle', ['rev-parse', '--verify', metadata.candidate + '^{tree}']);
  control('fresh-git-stored-tree-oracle', () => assert.ok(oracle.equals(Buffer.from(candidateTree + '\n'))));
  const candidateCompositionTree = treeHash([...composed, ...metadata.sourceEntries]);
  control('independent-candidate-composition', () => assert.equal(candidateCompositionTree, independentTree([...composed, ...metadata.sourceEntries])));
  assert.equal(results.length, preseal.expectedControlCount);
  capture.put('RESULT.json', { status: 'DATA_PASS_RUNTIME_HOLD', results, candidateCount: candidate.length, baseCount: base.length, actual98: actual.entries.length, selectedCount: inputs.length, candidateTree, independentTree: independent, composedTree: treeHash(composed), candidateCompositionTree, storedTreeEqual: true, builds: 0, productImports: 0, productPasses: 0, historical: '25 DATA / 68 NOT_RUN preserved', budgetDelta: 'none', readRouteDelta: 'none', ...capture.finish() });
} catch (reason) {
  capture.put('FAILURE.json', { status: 'DATA_FAIL_RUNTIME_HOLD', results, message: reason.message, stack: reason.stack, ...capture.finish() }); process.exitCode = 1;
}

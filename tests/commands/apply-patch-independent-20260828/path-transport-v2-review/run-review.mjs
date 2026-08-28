import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, sha256, objectId } from './review-reference.mjs';

const own = path.dirname(fileURLToPath(import.meta.url)), author = path.join(own, '../path-transport-v2');
const output = process.argv[2];
assert.equal(path.dirname(output), own); assert.match(path.basename(output), /^\.data-review-[a-z0-9-]+$/);
assert.equal(fs.existsSync(output), false); fs.mkdirSync(output);
const read = filename => JSON.parse(fs.readFileSync(filename));
const controls = read(path.join(own, 'CONTROLS.json')).controls;
const preparation = read(path.join(own, 'PREPARATION.json'));
const actual98 = read(path.join(own, 'ACTUAL98.json'));
const metadata = read(path.join(author, 'METADATA.json'));
const historicalMetadata = read(path.join(own, '../actual-v1/METADATA.json'));
const results = [], supplements = [], facts = {};
const started = Date.now();
let writtenBytes = 0;
const { parseTree, treeHash, verifyProjection, batchObjects, entryBytes } = await import('../path-transport-v2/path-bytes.mjs');
const { readCapture } = await import('../path-transport-v2/capture-io.mjs');
const normalized = entries => entries.map(entry => ({ mode: entry.mode, type: entry.type, oid: entry.blob, pathHex: entryBytes(entry).toString('hex') }));
function put(filename, data) {
  const bytes = Buffer.from(JSON.stringify(data)); writtenBytes += bytes.length;
  assert.ok(writtenBytes < 128 * 1024 * 1024); fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o644 });
}
function fixture(id, input) {
  const directory = path.join(output, id); fs.mkdirSync(directory);
  const fragments = input.fragments.map(({ recordIndex, ...descriptor }) => descriptor);
  put(path.join(directory, 'synthetic.json'), { id: 'synthetic', code: 0, signal: null, fault: null, closeObserved: true, groupAbsent: true, knownChildCleanup: true, bytes: input.bytes, stdoutSha256: input.stdoutSha256, stderrSha256: input.stderrSha256, fragments });
  const written = new Set(), consumed = new Set();
  for (const descriptor of input.fragments) {
    consumed.add(descriptor.recordIndex);
    if (written.has(descriptor.name) || input.records[descriptor.recordIndex] === undefined) continue;
    assert.equal(path.basename(descriptor.name), descriptor.name);
    put(path.join(directory, descriptor.name), input.records[descriptor.recordIndex]); written.add(descriptor.name);
  }
  input.records.forEach((record, index) => {
    if (!consumed.has(index)) put(path.join(directory, `unreferenced-record-${index}.json`), record);
  });
  return directory;
}
function capturedListing(id, bytes) {
  const record = { channel: 'stdout', offset: 0, totalBytes: bytes.length, base64: bytes.toString('base64'), sha256: sha256(bytes) };
  const input = { bytes: bytes.length, stdoutSha256: sha256(bytes), stderrSha256: sha256(Buffer.alloc(0)), fragments: bytes.length ? [{ name: 'synthetic-stdout-0.json', bytes: bytes.length, sha256: sha256(bytes), recordIndex: 0 }] : [], records: bytes.length ? [record] : [] };
  return readCapture(fixture(id, input), 'synthetic');
}
function historicalBody(stem) {
  const directory = path.join(own, '../actual-v1/evidence'), receipt = read(path.join(directory, stem + '.json'));
  assert.equal(receipt.code, 0); assert.equal(receipt.signal, null); assert.equal(receipt.fault, null); assert.equal(receipt.closeObserved, true); assert.equal(receipt.groupAbsent, true);
  let offset = 0; const chunks = [];
  for (const descriptor of receipt.fragments) {
    assert.equal(descriptor.name, `${stem}-stdout-${offset}.json`);
    const record = read(path.join(directory, descriptor.name)), bytes = Buffer.from(record.base64, 'base64');
    assert.equal(bytes.toString('base64'), record.base64); assert.equal(record.channel, 'stdout'); assert.equal(record.offset, offset); assert.equal(record.totalBytes, receipt.bytes);
    assert.equal(bytes.length, descriptor.bytes); assert.equal(sha256(bytes), descriptor.sha256); assert.equal(sha256(bytes), record.sha256);
    offset += bytes.length; chunks.push(bytes);
  }
  const body = Buffer.concat(chunks); assert.equal(body.length, receipt.bytes); assert.equal(sha256(body), receipt.stdoutSha256); assert.equal(receipt.stderrSha256, sha256(Buffer.alloc(0)));
  return body;
}
let candidate, base, candidateRaw, baseRaw, objects, composed;
function inventories() {
  if (candidate) return;
  candidateRaw = readCapture(path.join(author, 'inventory-v1'), 'candidate');
  baseRaw = readCapture(path.join(author, 'inventory-v1'), 'base');
  assert.equal(sha256(candidateRaw), actual98.rawListingSha256); assert.equal(candidateRaw.length, actual98.rawListingBytes);
  assert.equal(sha256(baseRaw), preparation.historicalCaptureBodies.base.sha256);
  candidate = parseTree(candidateRaw); base = parseTree(baseRaw);
}
function authenticatedObjects() {
  inventories();
  if (objects) return;
  const body = historicalBody('002-git-authenticated-inputs');
  assert.equal(sha256(body), preparation.historicalCaptureBodies.batch.sha256);
  const inputs = [...metadata.baseManifest.inputs, ...metadata.sourceEntries];
  const requests = [metadata.baseManifest.base, metadata.candidate, ...inputs.map(entry => entry.blob)];
  assert.equal(requests.length, 276); assert.equal(new Set(requests).size, requests.length);
  objects = batchObjects(body, requests);
  for (const entry of inputs) {
    const object = objects.get(entry.blob); assert.equal(object.kind, 'blob'); assert.equal(object.payload.length, entry.bytes); assert.equal(sha256(object.payload), entry.sha256);
  }
  verifyProjection(inputs, base, candidate, metadata);
  facts.actualBatch = { bytes: body.length, sha256: sha256(body), objectCount: objects.size, selectedPaths: inputs.length, sourceEntriesUnchanged: JSON.stringify(metadata.sourceEntries) === JSON.stringify(historicalMetadata.sourceEntries), baseManifestUnchanged: JSON.stringify(metadata.baseManifest) === JSON.stringify(historicalMetadata.baseManifest) };
  assert.equal(facts.actualBatch.sourceEntriesUnchanged, true); assert.equal(facts.actualBatch.baseManifestUnchanged, true);
}
function selectedMutation(id) {
  inventories(); const inputs = structuredClone([...metadata.baseManifest.inputs, ...metadata.sourceEntries]);
  const index = inputs.findIndex(entry => entry.revision === metadata.candidate); assert.ok(index >= 0);
  if (id === 'M04') inputs[index].mode = '100755';
  if (id === 'M05') inputs[index].blob = '0'.repeat(40);
  if (id === 'M06') inputs[index].path = 'absent-independent-source';
  if (id === 'M07') inputs.push(inputs[index]);
  if (id === 'M08') { const override = inputs.find(entry => entry.revision !== metadata.candidate && entry.revision !== metadata.baseManifest.base); inputs.push({ ...override, blob: '0'.repeat(40), mode: '100755' }); }
  return verifyProjection(inputs, base, candidate, metadata);
}
const sourceOnly = {
  P30: 'No nonrecursive record consumer exists in the repaired closure; recursive leaf parser intentionally excludes 040000/tree. Expected acceptance preserved, route NOT_RUN.',
  B12: 'OID request construction is inline controller.mjs:239-241, not an exported DATA function. No copied builder or controller dispatch is substituted. OID batch parsing and full selected bindings execute separately.',
  D02: 'No exported stored-claim admission API. Controller binds actual commit object payload/type/hash after batchObjects; missing stored-claim recipe remains unexecuted.',
  M03: 'Declared 50002 count comparison is inline controller.mjs:237; parseTree has no declared-count parameter. No fabricated helper pass.',
  M09: 'Extra unreferenced capture file is the C18 helper boundary. Whole inventory append rejection exists only in controller checkHarness, which is not dispatched.',
  M10: 'Bodyless-stub recipe is sourcequalified by actual imports plus negative body tests. No replacement stub or controller mutation is executed.',
  M11: 'All consumer replacement is a source integration property, not a dynamically dispatched control. See SOURCE-REVIEW.md.'
};
function execute(control) {
  const { id, input, expected } = control;
  if (control.family === 'raw-listing' || control.family === 'profile') {
    const raw = Buffer.from(input.listingBase64, 'base64');
    const entries = parseTree(id.startsWith('H') ? capturedListing(id, raw) : raw), root = treeHash(entries);
    if (expected.accepted) {
      assert.deepEqual(normalized(entries), expected.entries);
      assert.equal(root, expected.rootOid);
      const reference = canonical(expected.entries); assert.equal(reference.root.oid, root);
      assert.deepEqual(reference.directories, expected.directories);
      if (id.startsWith('H')) {
        inventories();
        const census = new Map(candidate.map(entry => [entry.pathBytes.toString('hex'), entry]));
        for (const entry of entries) assert.deepEqual(normalized([census.get(entry.pathBytes.toString('hex'))]), normalized([entry]));
        verifyProjection(entries.map(entry => ({ ...entry, revision: metadata.candidate })), base, candidate, metadata);
      }
    }
    return { root, entries: entries.length, routes: id.startsWith('H') ? ['readCapture', 'parseTree', 'treeHash', 'actual-full-census', 'verifyProjection'] : ['parseTree', 'treeHash'] };
  }
  if (control.family === 'capture') {
    const bytes = readCapture(fixture(id, input), 'synthetic');
    if (expected.accepted) { assert.equal(bytes.toString('base64'), expected.stdoutBase64); assert.deepEqual(normalized(parseTree(bytes)), expected.entries); }
    return { bytes: bytes.length, sha256: sha256(bytes), routes: ['readCapture'] };
  }
  if (control.family === 'batch') {
    const result = batchObjects(Buffer.from(input.responseBase64, 'base64'), input.requests);
    if (expected.accepted) assert.deepEqual([...result.values()].map(entry => ({ oid: entry.objectId, kind: entry.kind, bodyBase64: entry.payload.toString('base64') })), expected.objects);
    return { objects: result.size, routes: ['batchObjects'] };
  }
  if (id === 'B13') {
    const raw = Buffer.concat(input.entries.map(entry => Buffer.concat([Buffer.from(`${entry.mode} ${entry.type} ${entry.oid}\t`), Buffer.from(entry.pathHex, 'hex'), Buffer.from([0])])));
    const entries = parseTree(raw); assert.deepEqual(normalized(entries), input.entries.map(({ pathHex, mode, type, oid }) => ({ mode, type, oid, pathHex })));
    assert.equal(entries.length, expected.pathCount); assert.equal(new Set(entries.map(entry => entry.path)).size, expected.bindingCount);
    assert.equal(treeHash(entries), canonical(input.entries).root.oid);
    return { bindings: entries.length, qualification: 'Inventory mode/path/OID bindings; selected materialization intentionally permits only 100644. Inline request builder NOT_RUN.' };
  }
  if (id === 'D01') {
    const entries = input.leaves.map(leaf => {
      const bytes = leaf.bytes.hex ? Buffer.from(leaf.bytes.hex, 'hex') : Buffer.from(leaf.bytes.utf8);
      assert.equal(objectId('blob', bytes), leaf.blobSha1); assert.equal(sha256(bytes), leaf.sha256);
      return { path: leaf.name, mode: leaf.mode, type: 'blob', blob: leaf.blobSha1 };
    });
    assert.equal(treeHash(entries), expected.rootOid); assert.equal(canonical(normalized(entries)).root.payload.toString('hex'), input.treePayloadHex);
    return { root: expected.rootOid, storedLookups: 0 };
  }
  if (id === 'D03') {
    inventories(); assert.equal(candidate.length, input.records); assert.equal(treeHash(candidate), expected.rootOid);
    const reference = canonical(normalized(candidate)), stored = readCapture(path.join(author, 'inventory-v1'), 'stored-root');
    assert.ok(reference.root.payload.equals(stored)); assert.equal(sha256(stored), preparation.storedRootBodySha256); assert.equal(objectId('tree', stored), expected.rootOid);
    assert.equal(reference.directories.length, preparation.directoryCount);
    const special = normalized(candidate.filter(entry => entry.pathBytes.some(byte => byte < 32 || byte >= 127 || byte === 34 || byte === 92)));
    assert.deepEqual(special, actual98.entries.map(({ mode, type, oid, pathHex }) => ({ mode, type, oid, pathHex })));
    assert.equal(special.length, expected.quotedIdentities);
    for (const [capture, commit, tree] of [['candidate-commit', metadata.candidate, expected.rootOid], ['base-commit', metadata.baseManifest.base, metadata.baseManifest.baseTree], ['evidence-commit', metadata.evidence, null]]) {
      const bytes = readCapture(path.join(author, 'inventory-v1'), capture); assert.equal(objectId('commit', bytes), commit);
      if (tree) assert.equal(bytes.subarray(0, 46).toString(), `tree ${tree}\n`);
    }
    facts.candidate = { root: expected.rootOid, records: candidate.length, specialCount: special.length, listingBytes: candidateRaw.length, listingSha256: sha256(candidateRaw), rootPayloadBytes: stored.length, rootPayloadSha256: sha256(stored), referenceDirectories: reference.directories.length, incorrectRootRejected: expected.incorrectRootRejected, actual98IdentitiesSha256: sha256(Buffer.from(JSON.stringify(special))) };
    assert.notEqual(treeHash(candidate), expected.incorrectRootRejected);
    return facts.candidate;
  }
  if (id === 'D04') {
    authenticatedObjects();
    assert.equal(sha256(Buffer.from(JSON.stringify(metadata.baseManifest))), input.manifestSha256);
    assert.equal(treeHash(base), input.baseRoot); assert.equal(canonical(normalized(base)).root.oid, input.baseRoot);
    assert.ok(historicalBody('001-git-base-tree').equals(baseRaw));
    const overrides = metadata.baseManifest.inputs.filter(entry => entry.revision !== metadata.baseManifest.base);
    assert.deepEqual(overrides.map(({ path: filename, blob, mode, revision, sha256: digest }) => ({ path: filename, blob, mode, revision, sha256: digest })), input.overrides);
    const replacements = new Map(overrides.map(entry => [entry.path, entry])); assert.equal(replacements.size, 5);
    composed = base.map(entry => replacements.get(entry.path) ?? entry);
    const reference = canonical(composed.map(entry => ({ pathHex: Buffer.from(entry.path).toString('hex'), mode: entry.mode, oid: entry.blob })));
    assert.equal(treeHash(composed), expected.expectedDerivedRoot); assert.equal(reference.root.oid, expected.expectedDerivedRoot);
    const combined = [...composed, ...metadata.sourceEntries], combinedRoot = treeHash(combined);
    assert.equal(canonical(combined.map(entry => ({ pathHex: Buffer.from(entry.path).toString('hex'), mode: entry.mode, oid: entry.blob }))).root.oid, combinedRoot);
    facts.composition = { baseCommit: input.baseCommit, baseRoot: input.baseRoot, baseCount: base.length, derivedBase: expected.expectedDerivedRoot, candidateComposition: combinedRoot, combinedCount: combined.length, selected: metadata.baseManifest.inputs.length + metadata.sourceEntries.length, overrides: 5, storedLookupsForDerivedRoots: 0, baseListingSha256: sha256(baseRaw), derivedRootPayloadSha256: sha256(reference.root.payload) };
    return facts.composition;
  }
  if (/^M0[4-8]$/.test(id)) return selectedMutation(id);
  if (id === 'M01') return treeHash(parseTree(Buffer.from(historicalMetadata.candidateTrackedInventory)));
  if (id === 'M02') {
    const input = structuredClone(controls.find(row => row.id === 'C01').input), bytes = Buffer.from(input.records[0].base64, 'base64'); bytes[0] ^= 1; input.records[0].base64 = bytes.toString('base64');
    return readCapture(fixture(id, input), 'synthetic');
  }
  throw new Error(`unmapped control ${id}`);
}
try {
  assert.equal(controls.length, 206); assert.equal(new Set(controls.map(row => row.id)).size, 206);
  for (const control of controls) {
    assert.ok(Date.now() - started < 28000, 'DATA body deadline');
    if (sourceOnly[control.id]) { results.push({ id: control.id, status: 'NOT_RUN', qualification: 'SOURCEONLY', reason: sourceOnly[control.id] }); continue; }
    let observed, error;
    try { observed = execute(control); } catch (reason) { error = { name: reason.name, code: reason.code ?? null, message: String(reason.message).slice(0,1200), stack: reason.stack?.split('\n').slice(0,5) }; }
    const expectedAcceptance = control.expected.accepted ?? true;
    const passed = expectedAcceptance ? error === undefined : error !== undefined;
    const status = control.id === 'P28' && error ? 'UNSUPPORTED' : passed ? 'PASS' : 'FAIL';
    results.push({ id: control.id, status, expectedAccepted: expectedAcceptance, observedAccepted: error === undefined, observation: observed, error, qualification: control.id === 'P28' ? 'Declared strict UTF8-only domain; unchanged raw-byte expected acceptance is not met.' : control.id === 'C18' ? 'Helper accepts unreferenced file; full sealed inventory append guard is SOURCEONLY, not dynamically credited.' : undefined });
  }
  const missing = controls.filter(control => !results.some(result => result.id === control.id)); assert.equal(missing.length, 0);
} catch (reason) {
  facts.runnerFailure = { message: reason.message, stack: reason.stack };
  for (const control of controls) if (!results.some(result => result.id === control.id)) results.push({ id: control.id, status: 'NOT_RUN', reason: 'Runner prerequisite failure; not a candidate pass' });
} finally {
  const counts = Object.fromEntries(['PASS','FAIL','UNSUPPORTED','NOT_RUN'].map(status => [status, results.filter(result => result.status === status).length]));
  console.log(JSON.stringify({ schema: 'independent-repair-data-observations-v1', candidateCommit: 'd8cbb7d76459e14d20f57e19f7c01ce04fa08702', elapsedMs: Date.now() - started, originalExpectedOutcomesChanged: false, counts, dynamicDenominator: results.filter(result => result.status !== 'NOT_RUN').length, results, supplements, facts, syntheticBytesWritten: writtenBytes, compilerBuildInstallProductRuntimeNativeMutantNetworkDispatches: 0, metadataChildrenInDataBody: 0, instructionPlaintextSnapshots: 0 }));
}

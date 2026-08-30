import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const root = '/Users/kjopek/Workspace/safe-bash';
const directory = 'tests/commands/yq-independent-20260828';
assert.equal(process.cwd(), root);
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 1048576 });
const read = path => readFileSync(`${root}/${path}`);
const json = path => JSON.parse(read(path));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const crosswalk = json(`${directory}/reconciliation-v1/crosswalk.json`);
const sources = json(`${directory}/reconciliation-v1/sources.json`);
const selected = new Map();
assert.equal(sources.sources.length, 15);
for (const entry of sources.sources) {
  assert.match(entry.commit, /^[a-f0-9]{40}$/u);
  assert.match(entry.gitBlob, /^[a-f0-9]{40}$/u);
  assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  assert(!selected.has(entry.id));
  const reference = `${entry.commit}:${entry.path}`;
  const bytes = git('show', reference);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(digest(bytes), entry.sha256);
  assert.equal(git('rev-parse', reference).toString().trim(), entry.gitBlob);
  if (entry.compareWorkingBytes) assert.deepEqual(read(entry.path), bytes);
  selected.set(entry.id, bytes);
}

function verifySealedPackets() {
  for (const [name, cohort] of Object.entries(crosswalk.cohorts)) {
    if (!cohort?.commit) continue;
    const prefix = `${directory}/${name}`;
    const paths = git('ls-tree', '-r', '--name-only', cohort.commit, '--', prefix).toString().trim().split('\n');
    assert.equal(paths.length, name === 'freeze' ? 12 : 6);
    for (const path of paths) assert.deepEqual(read(path), git('show', `${cohort.commit}:${path}`), path);
    if (name === 'freeze') {
      const entries = readdirSync(`${root}/${prefix}`, { withFileTypes: true });
      assert(entries.every(entry => entry.isFile()), 'Original freeze gained a directory, symlink or non-file entry');
      assert.deepEqual(entries.map(entry => `${prefix}/${entry.name}`).sort(), paths.slice().sort());
    }
  }
}
verifySealedPackets();

const originals = new Map();
for (const name of ['command-parser', 'value-query', 'utf8', 'accounting', 'integration']) {
  for (const record of json(`${directory}/freeze/${name}.json`).cases) {
    assert(!originals.has(record.id));
    originals.set(record.id, record);
  }
}
const normative = new Map(JSON.parse(selected.get('normative-cases')).cases.map(record => [record.id, record]));
const query = new Map(JSON.parse(selected.get('query-cases')).cases.map(record => [record.id, record]));
assert.equal(originals.size, 194);
assert.equal(normative.size, 80);
assert.equal(query.size, 62);
assert.equal([...originals.values()].filter(record => record.blocked).length, 6);
assert.equal([...normative.values()].filter(record => record.expected.kind === 'blocked').length, 4);
assert.equal([...query.values()].filter(record => record.layer === 'blocked-choice').length, 2);
assert.equal(crosswalk.cohorts.newCaseRecords, 0);
assert.equal(crosswalk.cohorts.uniqueProductCaseUnion, null);
assert.deepEqual(crosswalk.execution, { product: 0, nativeOrReference: 0, independentLengthPackReplay: 0 });
assert.equal(crosswalk.implementationAuthorized, false);

function pointer(record, path) {
  assert(path.startsWith('/'));
  let value = record;
  for (const part of path.slice(1).split('/')) {
    assert(value !== null && typeof value === 'object' && Object.hasOwn(value, part), path);
    value = value[part];
  }
  return value;
}

function reviewCase(reference) {
  const [packet, id] = reference.split(':');
  const records = packet === 'normative' ? normative : packet === 'query-budget' ? query : originals;
  assert(['normative', 'query-budget', 'freeze'].includes(packet));
  assert(records.has(id), reference);
  return records.get(id);
}

for (const item of [...crosswalk.resolved, ...crosswalk.openChoices, ...crosswalk.observations]) {
  for (const reference of item.reviewCases) reviewCase(reference);
  for (const id of item.relatedOriginalRecords ?? []) assert(originals.has(id), id);
  for (const field of item.heldOriginalFields ?? []) pointer(originals.get(field.record), field.pointer);
  for (const path of item.originalFields ?? []) pointer(originals.get(item.record), path);
  if (item.witnessBinding) {
    const slash = item.witnessBinding.indexOf('/');
    const witness = pointer(reviewCase(item.witnessBinding.slice(0, slash)), item.witnessBinding.slice(slash));
    if (typeof witness === 'string') assert.equal(item.minimalWitness, witness);
    else for (const [key, value] of Object.entries(witness)) assert.deepEqual(item.minimalWitness[key], value);
  }
}
assert.deepEqual(crosswalk.openChoices.map(item => item.id), ['N1', 'N2', 'N3', 'N4', 'QB-F1', 'QB-F2', 'B-ENCODER-ESCAPE-SPELLING']);
assert.deepEqual(crosswalk.observations.map(item => item.id), ['N5']);
const coverage = crosswalk.originalCoverage;
assert.deepEqual(coverage.resolvedOriginalRecords, ['NUM-14', 'QUE-12', 'WRK-10']);
assert.deepEqual(coverage.stillGoldenHeldOriginalRecords, ['NUM-15', 'ENC-07', 'UTF-12']);
assert.deepEqual(coverage.additionalScopeHeldOriginalRecords, ['WRK-22']);
const overlays = [...coverage.resolvedOriginalRecords, ...coverage.stillGoldenHeldOriginalRecords, ...coverage.additionalScopeHeldOriginalRecords];
assert.equal(new Set(overlays).size, 7);
assert.equal(coverage.retainedWithoutRecordOverlay + overlays.length, originals.size);
assert.equal(coverage.uniqueHeldOriginalRecords, 4);
assert.deepEqual(crosswalk.resolved.map(item => item.record).sort(), coverage.resolvedOriginalRecords.slice().sort());
assert.deepEqual([...new Set(crosswalk.openChoices.flatMap(item => item.heldOriginalFields.map(field => field.record)))].sort(), ['ENC-07', 'NUM-15', 'UTF-12', 'WRK-22']);

const length = crosswalk.resolved.find(item => item.id === 'B-LENGTH-ACCEPTANCE');
assert.equal(length.acceptedSource, '74361026502d76b8c2b696f9c60e410ac9b78d95');
const relay = selected.get('length-relay').toString();
for (const field of ['acceptedSource', 'acceptedReview', 'acceptedPackageAddendum', 'packageRecipe', 'full846PackageSha256']) assert(relay.includes(length[field]));
assert(relay.includes('No length prerequisite remains.'));
assert.equal(crosswalk.currentCandidate.lengthPrerequisiteRemains, false);
assert.equal(crosswalk.currentCandidate.yqCodeGo, false);
assert.equal(crosswalk.currentCandidate.acceptedLength, length.acceptedSource);
assert.equal(crosswalk.currentCandidate.baseline, '5137a74ec855a32d8a8860eb66b62eb44d11e290');
const zero = crosswalk.resolved.find(item => item.id === 'B-NUMERIC-ZERO');
assert.equal(zero.inputUtf8, originals.get('NUM-14').input.stdinUtf8);
assert.equal(zero.inputUtf8, query.get('N10').input);
assert.deepEqual(zero.currentExpectation, { status: query.get('N10').expect.status, diagnosticCode: query.get('N10').expect.code, stdoutUtf8: query.get('N10').expect.stdout });
assert(selected.get('initial-readme').toString().includes('an out-of-range\n   exponent fails.'));
const depth = crosswalk.resolved.find(item => item.id === 'B-AST-DEPTH-LEXEME').currentBoundary;
assert.equal(depth.admittedCount, query.get('D04').queryRecipe.count);
assert.equal(depth.refusedCount, query.get('D05').queryRecipe.count);
assert.equal(depth.admittedAstDepth, depth.admittedCount + 1);
assert.equal(depth.refusedAstDepth, depth.refusedCount + 1);
assert.equal(depth.admittedAstDepth, JSON.parse(selected.get('final')).defaultBudgetMapping.maxAstDepth);
const parser = selected.get('parser-baseline').toString();
assert(parser.includes('if (accept("?")) result = { kind: "optional", operand: result! };'));
assert(parser.includes('[{ node: ast, depth: 1 }]'));
assert(parser.includes('pending.push({ node: child, depth: depth + 1 })'));

verifySealedPackets();
console.log(JSON.stringify({
  status: 'STATIC_CROSSWALK_PASS_NOT_PRODUCT_ACCEPTANCE', originalRecords: 194,
  newCaseRecords: 0, resolvedOriginalBlockers: 3, originalGoldenHeldRecords: 3,
  additionalScopeHeldRecords: 1, uniqueHeldOriginalRecords: 4,
  openChoiceIds: crosswalk.openChoices.map(item => item.id), observationIds: ['N5'],
  normativeBlockedRecords: 4, queryResourceBlockedRecords: 2, selectedSourceBindings: 15,
  originalFreezeFilesUnchanged: 12, lengthPrerequisiteRemains: false,
  productExecutions: 0, nativeOrReferenceExecutions: 0, independentLengthPackReplay: 0,
  writes: 0,
}, null, 2));

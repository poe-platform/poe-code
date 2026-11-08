import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const read = name => readFileSync(join(directory, name));
const json = name => JSON.parse(read(name).toString('utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sealBytes = read('PRESEAL-v1.json');
const seal = JSON.parse(sealBytes);
const inventory = [...seal.files.map(file => file.path), 'PRESEAL-v1.json'];
const optionalReceipt = 'SYNTHETIC-RECEIPT-v1.json';
const initialEntries = readdirSync(directory).sort();

function verifyInventory() {
  const entries = readdirSync(directory).sort();
  assert.deepEqual(entries.filter(name => name !== optionalReceipt), inventory.slice().sort());
  for (const name of entries) {
    assert.ok(!name.includes('/') && !name.includes('..'));
    const stat = lstatSync(join(directory, name));
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `regular owned artifact: ${name}`);
  }
  for (const file of seal.files) {
    const bytes = read(file.path);
    assert.equal(bytes.length, file.bytes, `${file.path} byte length`);
    assert.equal(sha256(bytes), file.sha256, `${file.path} preseal hash`);
  }
  assert.equal(sha256(read('PRESEAL-v1.json')), sha256(sealBytes));
  assert.deepEqual(entries, initialEntries, 'detect new entries as well as changed original paths');
}

verifyInventory();
const policy = json('POLICY-v1.json');
const original = json('ORIGINAL32-v1.json');
const author = json('AUTHOR32-PINNED-v1.json');
const supplement = json('SUPPLEMENT-v1.json');
const limits = json('LIMITS-v1.json');
const protocol = json('PROTOCOL-v1.json');
const sources = json('SOURCES-v1.json');

assert.equal(original.cases.length, 32);
assert.equal(author.literalCases.length, 32);
assert.equal(supplement.cases.length, 80);
assert.equal(limits.cases.length, 14);
assert.equal(protocol.controls.length, 20);
assert.equal(protocol.treeControls.length, 2);
assert.equal(protocol.reasonControls.length, 5);
assert.equal(policy.candidateInspected, false);
assert.equal(policy.productExecuted, false);

let byteSpecCount = 0;
let exactByteSpecCount = 0;
function byteLength(specification) {
  if (Object.hasOwn(specification, 'utf8')) {
    assert.equal(typeof specification.utf8, 'string');
    assert.ok(specification.utf8.isWellFormed(), 'byte text has valid scalar encoding');
    return Buffer.byteLength(specification.utf8);
  }
  if (Object.hasOwn(specification, 'hex')) {
    assert.match(specification.hex, /^(?:[0-9a-f]{2})*$/);
    return specification.hex.length / 2;
  }
  if (Object.hasOwn(specification, 'concat')) {
    if (!Array.isArray(specification.concat)) return null;
    const lengths = specification.concat.map(part => byteLength(part));
    if (lengths.includes(null)) return null;
    const total = lengths.reduce((sum, value) => sum + value, 0);
    assert.ok(Number.isSafeInteger(total));
    return total;
  }
  if (Object.hasOwn(specification, 'repeat')) {
    const length = byteLength(specification.repeat);
    if (typeof specification.count !== 'number' || length === null) return null;
    assert.ok(Number.isSafeInteger(specification.count) && specification.count >= 0);
    const total = specification.count * length;
    assert.ok(Number.isSafeInteger(total));
    return total;
  }
  return null;
}

function walk(value, depth = 0) {
  assert.ok(depth < 64);
  if (value === null || typeof value !== 'object') return;
  if (Object.hasOwn(value, 'utf8') || Object.hasOwn(value, 'hex')) {
    byteSpecCount += 1;
    if (byteLength(value) !== null) exactByteSpecCount += 1;
  } else if (Object.hasOwn(value, 'repeat') || Object.hasOwn(value, 'concat')) {
    byteSpecCount += 1;
    if (byteLength(value) !== null) exactByteSpecCount += 1;
  }
  if (Object.hasOwn(value, 'utf16CodeUnits')) {
    assert.ok(Array.isArray(value.utf16CodeUnits));
    assert.ok(value.utf16CodeUnits.every(unit => Number.isInteger(unit) && unit >= 0 && unit <= 65535));
  }
  for (const child of Object.values(value)) walk(child, depth + 1);
}

const allIds = new Set();
for (const collection of [original.cases, supplement.cases, limits.cases, protocol.controls, protocol.treeControls, protocol.reasonControls]) {
  for (const row of collection) {
    assert.equal(row.execution, 'NOT_RUN');
    assert.ok(!allIds.has(row.id), `unique case id ${row.id}`);
    allIds.add(row.id);
    for (const constraint of row.expected?.constraints ?? row.constraints ?? []) {
      assert.ok(Object.hasOwn(policy.constraints, constraint), `known constraint ${constraint}`);
    }
    if (row.expected?.outcome?.kind === 'return') {
      assert.ok([0, 1, 2].includes(row.expected.outcome.exitCode));
    }
    for (const path of row.expected?.absent ?? []) {
      assert.ok(!Object.hasOwn(row.expected.files ?? {}, path), `absent path not also expected file ${row.id}`);
    }
    walk(row);
  }
}

const fileMap = values => Object.fromEntries(Object.entries(values).map(([path, value]) => [path, { utf8: value }]));
for (const [index, row] of original.cases.entries()) {
  const planned = author.literalCases[index];
  assert.equal(row.id, `P${String(index + 1).padStart(2, '0')}`);
  assert.equal(row.id, planned.id);
  assert.equal(row.origin.revision, 'bf25da0ed51b3d7cddf295a698020c524d4c27a3');
  const patch = planned.patch ?? `*** Begin Patch\n${planned.body}*** End Patch\n`;
  assert.equal(planned.input === 'argument' ? row.invocation.args[0] : row.invocation.stdin.chunks[0].utf8, patch);
  assert.equal(row.expected.outcome.exitCode, planned.status);
  assert.deepEqual(row.before.files, fileMap(planned.before ?? {}));
  const after = { ...(planned.before ?? {}), ...(planned.after ?? {}) };
  for (const path of planned.absent ?? []) delete after[path];
  assert.deepEqual(row.expected.files, fileMap(after));
  assert.deepEqual(row.expected.absent, planned.absent ?? []);
  if (planned.fsCalls !== undefined) assert.equal(row.expected.fsCalls, planned.fsCalls);
  if (planned.status === 0) {
    assert.ok(row.expected.stdout.utf8.startsWith('Success. Updated the following files:\n'));
    assert.ok(!row.expected.stdout.utf8.includes('undefined'));
    assert.deepEqual(row.expected.stderr, { utf8: '' });
  } else assert.deepEqual(row.expected.stdout, { utf8: '' });
}

for (const input of sources.pinnedAuthorInputs) {
  const snapshot = input.path.endsWith('CASES-v1.json') ? 'AUTHOR32-PINNED-v1.json' : 'PROFILE-PINNED-v1.md';
  assert.equal(read(snapshot).length, input.bytes);
  assert.equal(sha256(read(snapshot)), input.sha256);
}

for (const row of limits.cases) {
  assert.equal(row.limit, policy.limits[row.cap]);
  assert.equal(row.endpoints.length, 2);
  assert.equal(row.endpoints[0].value, row.limit);
  assert.equal(row.endpoints[1].value, row.limit + 1);
}

function ownData(object, keys) {
  if (object === null || typeof object !== 'object') return false;
  const actual = Reflect.ownKeys(object);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
  });
}

function acceptedRecord(record) {
  if (!ownData(record, protocol.validationContract.keys)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const ids = descriptors.caseIds.value;
  if (!Array.isArray(ids) || !ownData(ids, ['0', '1', 'length'])) return false;
  const items = Object.getOwnPropertyDescriptors(ids);
  return descriptors.version.value === 1
    && descriptors.role.value === 'independent-matrix'
    && descriptors.route.value === 'synthetic-data-only'
    && descriptors.execution.value === 'NOT_RUN'
    && items.length.value === 2
    && items['0'].value === 'P01'
    && items['1'].value === 'S01';
}

let accessorCalls = 0;
let coercionCalls = 0;
const getter = () => { accessorCalls += 1; return 'independent-matrix'; };
function transform(kind) {
  const record = structuredClone(protocol.validRecord);
  switch (kind) {
    case 'identity': return record;
    case 'cross-realm': return runInNewContext(`(${JSON.stringify(protocol.validRecord)})`);
    case 'null-prototype': return Object.assign(Object.create(null), record);
    case 'extra-enumerable': record.extra = true; break;
    case 'extra-nonenumerable': Object.defineProperty(record, 'extra', { value: true }); break;
    case 'extra-symbol': record[Symbol('extra')] = true; break;
    case 'accessor': Object.defineProperty(record, 'role', { get: getter }); break;
    case 'array-hole': delete record.caseIds[0]; break;
    case 'array-extra': record.caseIds.extra = true; break;
    case 'reverse-sequence': record.caseIds.reverse(); break;
    case 'duplicate-case': record.caseIds[1] = 'P01'; break;
    case 'nan-version': record.version = NaN; break;
    case 'boxed-version': record.version = { valueOf() { coercionCalls += 1; return 1; } }; break;
    case 'inherited-role': delete record.role; Object.setPrototypeOf(record, { role: 'independent-matrix' }); break;
    case 'missing-field': delete record.execution; break;
    case 'wrong-role': record.role = 'author'; break;
    case 'wrong-execution': record.execution = 'PASS'; break;
    case 'wrong-route': record.route = 'product'; break;
    case 'array-accessor': Object.defineProperty(record.caseIds, '0', { get: getter }); break;
    case 'infinite-version': record.version = Infinity; break;
    default: throw new Error('Unknown finite synthetic transformation');
  }
  return record;
}

const transportResults = protocol.controls.map(control => {
  assert.equal(acceptedRecord(transform(control.transformation)), control.expected.accepted, control.id);
  assert.equal(accessorCalls, control.expected.accessorCalls);
  assert.equal(coercionCalls, control.expected.coercionCalls);
  return { id: control.id, result: 'SYNTHETIC_EXPECTATION_MET', productDispatches: 0 };
});

const reasonResults = protocol.reasonControls.map(control => {
  const reason = control.reason.kind === 'undefined' ? undefined : control.reason.value;
  const record = new Proxy({}, { ownKeys() { throw reason; } });
  let rejected = false;
  try {
    acceptedRecord(record);
  } catch (caught) {
    rejected = true;
    assert.ok(Object.is(caught, reason));
  }
  assert.equal(rejected, control.expected.sameThrownValue);
  return { id: control.id, result: 'SYNTHETIC_EXACT_THROWN_VALUE_PRESERVED', productDispatches: 0 };
});

const gitDigest = (kind, bytes) => createHash('sha1').update(Buffer.from(`${kind} ${bytes.length}\0`)).update(bytes).digest('hex');
const derived = protocol.treeControls[0];
const payload = Buffer.concat(derived.leaves.map(leaf => {
  const bytes = leaf.bytes.utf8 === undefined ? Buffer.from(leaf.bytes.hex, 'hex') : Buffer.from(leaf.bytes.utf8);
  assert.equal(sha256(bytes), leaf.sha256);
  assert.equal(gitDigest('blob', bytes), leaf.blobSha1);
  return Buffer.concat([Buffer.from(`${leaf.mode} ${leaf.name}\0`), Buffer.from(leaf.blobSha1, 'hex')]);
}));
assert.deepEqual(derived.leaves.map(leaf => leaf.name), ['a.txt', 'b.txt']);
assert.equal(payload.toString('hex'), derived.treePayloadHex);
assert.equal(gitDigest('tree', payload), derived.treeSha1);
const stored = protocol.treeControls[1];
assert.equal(stored.suppliedObjectEvidence, null);
assert.equal(stored.expected.accepted, false);
assert.equal(stored.treeSha1, derived.treeSha1);

verifyInventory();
const expandedSupplementScenarios = supplement.cases.reduce((count, row) => count + (row.variants?.length ?? 1), 0);
console.log(JSON.stringify({
  version: 1,
  checkedAtUtc: new Date().toISOString(),
  role: 'DATA_SYNTHETIC_ONLY',
  presealSha256: sha256(sealBytes),
  sealedFiles: seal.files.length,
  fullInventoryCheckedBeforeAndAfter: true,
  newEntryDetection: true,
  originalMappedRows: original.cases.length,
  supplementRows: supplement.cases.length,
  expandedSupplementScenarios,
  capRows: limits.cases.length,
  capEndpoints: limits.cases.reduce((count, row) => count + row.endpoints.length, 0),
  additionalCapProbes: limits.cases.filter(row => row.additionalProbe).length,
  byteSpecCount,
  exactByteSpecCount,
  transportResults,
  reasonResults,
  derivedTreeControl: 'SYNTHETIC_CANONICAL_BYTES_AUTHENTICATED_NO_GIT_LOOKUP',
  storedClaimControl: 'SYNTHETIC_UNAUTHENTICATED_CLAIM_REFUSED_NO_EXISTENCE_ASSERTION',
  productStatus: 'NOT_RUN',
  semanticPasses: 0,
  candidateInspections: 0,
  productImports: 0,
  subprocesses: 0,
  networkCalls: 0,
  fileWrites: 0,
  qualification: 'Fixture consistency and finite protocol rehearsal only; no parser, matcher, VFS, product/native/comparator/Codex CLI, public integration or source-bound limit execution.'
}, null, 2));

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../..');
const state = 'PRECODE_FUTURE_ASSERTIONS_NOT_EXECUTED';
const dataFiles = ['command-parser.json', 'value-query.json', 'utf8.json', 'accounting.json', 'integration.json'];
const expectedCounts = {
  COMMAND: 24, PARSER: 36, NUMERIC: 16, ENCODER: 10, QUERY: 12,
  ALIAS: 15, UTF8: 22, WORK: 26, LIFECYCLE: 10, FS: 6,
  MOVED: 3, TYPE: 8, NEGATIVE_CONTROL: 6,
};
const blockers = {
  'NUM-14': 'B-NUMERIC-ZERO',
  'NUM-15': 'B-NUMERIC-NORMALIZATION',
  'ENC-07': 'B-ENCODER-ESCAPE-SPELLING',
  'QUE-12': 'B-LENGTH-ACCEPTANCE',
  'UTF-12': 'B-SURROGATE-PAIR-ESCAPES',
  'WRK-10': 'B-AST-DEPTH-LEXEME',
};
const replayNames = new Set([
  'R-CANDIDATE-AUTHENTICATION', 'R-INTERNAL-OBSERVATION', 'R-HOST-HARNESS',
  'R-PUBLIC-CONSUMER', 'R-AUTHORIZED-ADAPTER',
]);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function boundedRead(path) {
  const metadata = await lstat(path);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `Not a regular file: ${path}`);
  assert(metadata.size <= 1048576, `Preparation file too large: ${path}`);
  return readFile(path);
}

async function json(name) {
  return JSON.parse(await boundedRead(resolve(directory, name)));
}

async function inventory(parent = directory, prefix = '') {
  const entries = await readdir(parent, { withFileTypes: true });
  assert(entries.length <= 100, 'Unexpectedly broad preparation tree');
  const names = [];
  for (const entry of entries) {
    assert(!entry.isSymbolicLink(), 'Symlinks are not preparation artifacts');
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      names.push(`${name}/`, ...await inventory(resolve(parent, entry.name), `${name}/`));
    } else {
      assert(entry.isFile(), 'Unexpected preparation entry kind');
      names.push(name);
    }
  }
  return names.sort();
}

function validateInventory(names, manifest) {
  assert.deepEqual(names, [...manifest.files.map(entry => entry.path), 'integrity.json'].sort());
}

function validateDigest(bytes, entry) {
  assert.equal(bytes.byteLength, entry.bytes, entry.path);
  assert.equal(digest(bytes), entry.sha256, entry.path);
}

async function verifyTree(manifest) {
  validateInventory(await inventory(), manifest);
  for (const entry of manifest.files) {
    assert(/^[A-Za-z0-9][A-Za-z0-9.-]*$/u.test(entry.path), 'Nonlocal manifest path');
    assert(/^[a-f0-9]{64}$/u.test(entry.sha256));
    validateDigest(await boundedRead(resolve(directory, entry.path)), entry);
  }
}

function pointer(document, suffix) {
  assert(suffix.startsWith('/'));
  let value = document;
  for (const segment of suffix.slice(1).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    assert(value !== null && typeof value === 'object' && Object.hasOwn(value, key), `Missing authority pointer ${suffix}`);
    value = value[key];
  }
  return value;
}

function hexBytes(text) {
  assert.equal(typeof text, 'string');
  assert(/^(?:[a-f0-9]{2})*$/u.test(text));
  return Buffer.from(text, 'hex');
}

function validateExpected(record, diagnostics) {
  assert(record.expect && Object.keys(record.expect).length > 0, record.id);
  if (record.expect.diagnosticCode !== undefined) {
    const diagnostic = diagnostics.find(entry => entry[1] === record.expect.diagnosticCode);
    assert(diagnostic, `Unknown diagnostic in ${record.id}`);
    assert.notEqual(diagnostic[1], 'ALIAS_DUPLICATE_ANCHOR', 'Reserved diagnostic cannot be emitted');
    if (typeof diagnostic[2] === 'number') assert.equal(record.expect.status, diagnostic[2], record.id);
  }
  if (record.expect.status !== undefined) assert([0, 2, 3, 5].includes(record.expect.status), record.id);
  if (record.expect.stdoutHex !== undefined) hexBytes(record.expect.stdoutHex);
  assert.equal(record.blocked, blockers[record.id], `Blocker drift: ${record.id}`);
}

const manifestBytes = await boundedRead(resolve(directory, 'integrity.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.caseRecords, 194);
assert.deepEqual(manifest.categoryCounts, expectedCounts);
await verifyTree(manifest);

const fixed = await json('fixed-values.json');
const bindings = await json('source-bindings.json');
assert.equal(bindings.sources.length, 20);
assert.equal(bindings.futureCandidate.lengthAcceptedByThisAuthor, false);
assert.equal(bindings.futureCandidate.candidateAccepted, false);
const selected = new Map();
for (const source of bindings.sources) {
  assert(/^[a-f0-9]{40}$/u.test(source.commit));
  assert(/^[a-f0-9]{40}$/u.test(source.gitBlob));
  assert(/^[a-f0-9]{64}$/u.test(source.sha256));
  assert(!selected.has(source.id));
  selected.set(source.id, source);
}
const authorities = {};
for (const id of ['initial-readme', 'initial', 'final-readme', 'final', 'adoption-readme', 'adoption']) {
  const source = selected.get(id);
  assert(source.path.startsWith('tests/commands/yq-design-20260828/'));
  const bytes = await boundedRead(resolve(repository, source.path));
  validateDigest(bytes, source);
  if (source.path.endsWith('.json')) authorities[id] = JSON.parse(bytes);
}
const contract = authorities.final;
const adoption = authorities.adoption;
assert.equal(selected.get('final').commit, '5783b8e03912f7774d2a86ba1dae9de778121273');
assert.equal(selected.get('adoption').commit, 'cfa6fbcb72c5a3e228c4ffbea7cb1719827b2707');
assert.deepEqual(fixed.caps, contract.fixedPrivateCaps.values);
assert.deepEqual(fixed.budget, contract.defaultBudgetMapping);
assert.deepEqual(fixed.decimalRange, [-1147483646, 999999999]);
assert(contract.numericAmendments.rules.includes('[-1147483646, 999999999]'));
assert.equal(Object.keys(fixed.caps).length, 21);
assert.equal(fixed.caps.stdoutCapBytes + fixed.caps.diagnosticReserveBytes, fixed.caps.maxOutputBytes);
assert.deepEqual(fixed.diagnostics, contract.diagnostics.catalogue.map(entry => [entry.category, entry.code, entry.status]));
assert.equal(fixed.diagnostics.length, 54);
assert.equal(new Set(fixed.diagnostics.map(entry => entry[1])).size, 54);
assert.deepEqual(fixed.reservedUnreachable, ['ALIAS_DUPLICATE_ANCHOR']);
assert.equal(adoption.diagnostics.reservedConflict.code, fixed.reservedUnreachable[0]);
assert.equal(adoption.resolvedGrammar.anchorReuse.limit.value, fixed.caps.maxAnchorsPerDocument);
assert.equal(adoption.resolvedGrammar.anchorReuse.decision, 'Y2_DUPLICATE_ANCHOR_A_WITH_PENDING_SHADOW_RULE');
assert.equal(adoption.resolvedGrammar.quotedNbJson.decision, 'Y1_QUOTED_NB_JSON_A_QUALIFIED');
for (const name of ['help', 'version']) {
  const bytes = Buffer.from(contract.exactInformation[name]);
  assert.equal(bytes.length, fixed.information[`${name}Utf8Bytes`]);
  assert.equal(digest(bytes), fixed.information[`${name}Sha256`]);
  assert.equal(bytes.at(-1), 10);
}
assert.equal(contract.exactInformation.version, 'virtual-bash restricted YAML profile\n');
for (const source of contract.fixedSourceReferences) {
  const match = bindings.sources.find(entry => entry.path === source.path && entry.commit === bindings.futureCandidate.baseline);
  assert(match, source.path);
  assert.equal(match.gitBlob, source.gitBlob);
}

function validateAuthority(reference) {
  const [name, fragment] = reference.split('#');
  if (name === 'final' || name === 'adoption') pointer(authorities[name], fragment);
  else if (name === 'initial') assert(/^\d+(?:\.\d+)?$/u.test(fragment));
  else if (name === 'primary') assert(bindings.primary.sections.includes(fragment));
  else if (name === 'freeze') assert.equal(fragment, 'integrity');
  else assert(selected.has(reference), `Unknown source: ${reference}`);
}

const { materializeRecipe } = await import('./recipes.mjs');
const identifiers = new Set();
const actualCounts = {};
const actualBlockers = {};
const recipes = [];
const allRecords = [];
let chunkVariants = 0;
for (const name of dataFiles) {
  const dataset = await json(name);
  assert.equal(dataset.state, state);
  assert.equal(dataset.schemaVersion, 1);
  for (const record of dataset.cases) {
    assert(/^[A-Z]+-\d{2}$/u.test(record.id));
    assert(!identifiers.has(record.id), record.id);
    identifiers.add(record.id);
    assert(Object.hasOwn(expectedCounts, record.category), record.category);
    actualCounts[record.category] = (actualCounts[record.category] ?? 0) + 1;
    assert(record.input && Object.keys(record.input).length > 0, record.id);
    for (const reference of record.authority ?? dataset.defaults.authority) validateAuthority(reference);
    for (const prerequisite of record.replay ?? dataset.defaults.replay ?? []) assert(replayNames.has(prerequisite));
    validateExpected(record, fixed.diagnostics);
    if (record.blocked) actualBlockers[record.id] = record.blocked;
    if (record.expect.stdoutBinding) {
      validateAuthority(record.expect.stdoutBinding);
      assert.equal(typeof pointer(contract, record.expect.stdoutBinding.split('#')[1]), 'string');
    }
    if (record.input.counter) {
      assert(Object.hasOwn(fixed.caps, record.input.counter));
      const maximum = fixed.caps[record.input.counter];
      if (record.input.boundary) assert.deepEqual(record.input.boundary, [maximum, maximum + 1]);
      if (record.input.projection) {
        const { before, admit, next } = record.input.projection;
        for (const value of [before, admit, next]) assert(Number.isSafeInteger(value) && value >= 0);
        assert.equal(before + admit, maximum);
        assert.equal(before + admit + next, maximum + 1);
      }
    }
    let inputBytes;
    if (record.input.stdinUtf8 !== undefined) inputBytes = Buffer.from(record.input.stdinUtf8, 'utf8');
    if (record.input.stdinHex !== undefined) {
      assert.equal(inputBytes, undefined);
      inputBytes = hexBytes(record.input.stdinHex);
    }
    if (record.input.stdinChunksHex !== undefined) {
      assert.equal(inputBytes, undefined);
      inputBytes = Buffer.concat(record.input.stdinChunksHex.map(hexBytes));
    }
    if (record.input.stdinRecipe) {
      assert.equal(inputBytes, undefined);
      inputBytes = materializeRecipe(record.input.stdinRecipe);
      recipes.push({ id: record.id, bytes: inputBytes.length, sha256: digest(inputBytes) });
    }
    if (record.input.chunkPlan) {
      assert(inputBytes && inputBytes.length <= 1024);
      assert(['single-byte-chunks', 'every-single-cut-and-single-byte-chunks'].includes(record.input.chunkPlan));
      const singleBytes = Array.from(inputBytes, byte => Buffer.from([byte]));
      assert.deepEqual(Buffer.concat(singleBytes), inputBytes);
      chunkVariants++;
      if (record.input.chunkPlan.startsWith('every')) {
        for (let offset = 0; offset <= inputBytes.length; offset++) {
          assert.deepEqual(Buffer.concat([inputBytes.subarray(0, offset), inputBytes.subarray(offset)]), inputBytes);
          chunkVariants++;
        }
      }
    }
    allRecords.push(record);
  }
}
assert.equal(identifiers.size, 194);
assert.deepEqual(actualCounts, expectedCounts);
assert.deepEqual(actualBlockers, blockers);
assert.deepEqual(recipes, manifest.recipeInputs);
assert.equal(chunkVariants, manifest.preparationChunkPartitions);

const entry = manifest.files[0];
const altered = Buffer.from(await boundedRead(resolve(directory, entry.path)));
altered[0] ^= 1;
assert.throws(() => validateDigest(altered, entry));
assert.throws(() => validateInventory([...manifest.files.map(item => item.path), 'integrity.json', 'unlisted-entry/'].sort(), manifest));
const reserved = structuredClone(allRecords.find(record => record.id === 'ALS-02'));
reserved.expect = { status: 5, diagnosticCode: 'ALIAS_DUPLICATE_ANCHOR' };
assert.throws(() => validateExpected(reserved, fixed.diagnostics));

await verifyTree(manifest);
assert.deepEqual(await boundedRead(resolve(directory, 'integrity.json')), manifestBytes);
console.log(JSON.stringify({
  state: 'PREPARATION_CHECKS_ONLY', caseRecords: identifiers.size, categoryCounts: actualCounts,
  blockedRecords: Object.keys(actualBlockers).length, diagnosticBindings: fixed.diagnostics.length,
  recipeInputsChecked: recipes.length, chunkPartitionsChecked: chunkVariants,
  inMemoryNegativeControls: 3, productExecutions: 0, nativeOrReferenceExecutions: 0,
}, null, 2));

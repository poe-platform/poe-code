import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';

const root = '/Users/kjopek/Workspace/safe-bash';
const prefix = 'tests/commands/yq-independent-20260828';
const directory = `${prefix}/adopted-n-encoder-v1`;
assert.equal(process.cwd(), root);
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 1048576 });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => {
  const stat = lstatSync(`${root}/${path}`);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1048576, path);
  return readFileSync(`${root}/${path}`);
};
const json = path => JSON.parse(read(path));
const sources = json(`${directory}/sources.json`);
const decisions = json(`${directory}/decisions.json`);
const packet = json(`${directory}/cases.json`);
const parent = '544f8279138cb1335ded08f9db638410e91c1324';
assert.equal(sources.parentCheckpoint, parent);
assert.equal(sources.files.length, 9);
assert.equal(sources.trees.length, 4);
git('merge-base', '--is-ancestor', parent, sources.authenticationHead);
git('merge-base', '--is-ancestor', parent, 'HEAD');
const selected = new Map();
const validateBytes = (bytes, expected) => {
  assert.equal(bytes.length, expected.bytes);
  assert.equal(digest(bytes), expected.sha256);
};
for (const source of sources.files) {
  assert.match(source.commit, /^[a-f0-9]{40}$/u);
  assert.match(source.gitBlob, /^[a-f0-9]{40}$/u);
  assert.match(source.sha256, /^[a-f0-9]{64}$/u);
  assert(!selected.has(source.id));
  const reference = `${source.commit}:${source.path}`;
  const bytes = git('show', reference);
  validateBytes(bytes, source);
  assert.equal(git('rev-parse', reference).toString().trim(), source.gitBlob);
  if (source.compareWorktree) assert.deepEqual(read(source.path), bytes);
  selected.set(source.id, bytes);
}
const validateNames = (actual, expected) => assert.deepEqual(actual.slice().sort(), expected.slice().sort());
function verifyPreservedTrees() {
  let total = 0;
  for (const tree of sources.trees) {
    assert.equal(tree.path, `${prefix}/${tree.name}`);
    assert.equal(git('rev-parse', `${tree.commit}:${tree.path}`).toString().trim(), tree.tree);
    assert.equal(git('rev-parse', `${parent}:${tree.path}`).toString().trim(), tree.tree);
    const entries = git('ls-tree', '-r', tree.commit, '--', tree.path).toString().trim().split('\n').map(line => {
      const [metadata, path] = line.split('\t');
      const [mode, kind, blob] = metadata.split(' ');
      assert.equal(kind, 'blob');
      assert.equal(mode, '100644');
      assert(!path.slice(tree.path.length + 1).includes('/'));
      return { path, blob };
    });
    assert.equal(entries.length, tree.files);
    const actual = readdirSync(`${root}/${tree.path}`, { withFileTypes: true });
    assert(actual.every(entry => entry.isFile() && !entry.isSymbolicLink()));
    validateNames(actual.map(entry => `${tree.path}/${entry.name}`), entries.map(entry => entry.path));
    for (const entry of entries) {
      assert.equal(lstatSync(`${root}/${entry.path}`).mode & 0o111, 0);
      assert.deepEqual(read(entry.path), git('show', `${tree.commit}:${entry.path}`));
    }
    total += entries.length;
  }
  assert.equal(total, 29);
  const original = sources.queryOriginalSeal;
  const queryPath = `${prefix}/query-budget`;
  assert.equal(git('rev-parse', `${original.commit}:${queryPath}`).toString().trim(), original.tree);
  const paths = git('ls-tree', '-r', '--name-only', original.commit, '--', queryPath).toString().trim().split('\n');
  assert.equal(paths.length, 6);
  for (const path of paths) assert.deepEqual(read(path), git('show', `${original.commit}:${path}`));
  return total;
}
verifyPreservedTrees();
const contract = JSON.parse(selected.get('final'));
const adoption = JSON.parse(selected.get('adoption'));
assert.equal(digest(selected.get('final')), adoption.authority.finalContract.contract.sha256);
assert.equal(digest(selected.get('final-readme')), adoption.authority.finalContract.readme.sha256);
assert.equal(digest(selected.get('initial')), contract.authority.initialProfileReadme.sha256);
const catalogue = new Map(contract.diagnostics.catalogue.map(entry => [entry.code, entry]));
assert.equal(contract.diagnostics.catalogue.length, 54);
assert.equal(catalogue.size, 54);
const prior = new Map();
const freeze = new Map();
for (const name of ['command-parser', 'value-query', 'utf8', 'accounting', 'integration']) {
  for (const record of json(`${prefix}/freeze/${name}.json`).cases) {
    assert(!freeze.has(record.id));
    freeze.set(record.id, record);
    prior.set(`freeze:${record.id}`, record);
  }
}
const normative = json(`${prefix}/normative/cases.json`).cases;
const query = json(`${prefix}/query-budget/CASES.json`).cases;
for (const record of normative) prior.set(`normative:${record.id}`, record);
for (const record of query) prior.set(`query-budget:${record.id}`, record);
assert.equal(freeze.size, 194);
assert.equal(normative.length, 80);
assert.equal(query.length, 62);
assert.equal([...freeze.values()].filter(record => record.blocked).length, 6);
assert.equal(normative.filter(record => record.expected.kind === 'blocked').length, 4);
assert.equal(query.filter(record => record.layer === 'blocked-choice').length, 2);

function validateDecisions(data) {
  assert.equal(data.implementationAuthorized, false);
  assert.equal(data.rootAuthority.parentCheckpoint, parent);
  assert.equal(data.rootAuthority.finalContract, '5783b8e03912f7774d2a86ba1dae9de778121273');
  assert.equal(data.rootAuthority.additiveAdoption, 'cfa6fbcb72c5a3e228c4ffbea7cb1719827b2707');
  assert.equal(data.rootAuthority.decisionQuotes.ENCODER, 'Encoder NUL exact literal escape \\u0000.');
  assert.deepEqual(data.preservedCohorts, { freeze: 194, normative: 80, queryBudget: 62, sumAsUniqueProductCases: null, edited: false, rescored: false });
  assert.deepEqual(data.execution, { product: 0, nativeOrReference: 0, typeOrBuild: 0, lengthReplay: 0 });
  assert.equal(data.resourceDirections.preciseMechanism, null);
  assert.equal(data.resourceDirections.mechanismAccepted, false);
  assert.equal(data.resourceDirections.finalResourceFreezeComplete, false);
  assert.equal(data.resourceDirections.originalWRK22Hold.retained, true);
  assert.equal(data.resourceDirections.originalWRK22Hold.rescored, false);
  assert.equal(data.resourceDirections['QB-F1'].newYqOwnedAsyncTraversal, true);
  assert.equal(data.resourceDirections['QB-F1'].ownedCheckpointsRequired, true);
  assert.equal(data.resourceDirections['QB-F1'].newFilesOnly, true);
  assert.equal(data.resourceDirections['QB-F1'].existingInternalSyncPhasesStillQualified, true);
  assert.equal(data.resourceDirections['QB-F1'].broadRefactor, false);
  const alias = data.resourceDirections['QB-F2'];
  for (const key of ['wholeCopyPreadmission', 'includesCheckpointCharges', 'estimationSeparatelyCharged', 'actualPrivateBudgetAdmissionBeforeCopy', 'consumeOnce']) assert.equal(alias[key], true);
  for (const key of ['refunds', 'newBudgetPerAliasOrDocument', 'interleavedQueryConsumption']) assert.equal(alias[key], false);
  assert.equal(data.catalogue.entries, 54);
  assert.equal(data.catalogue.changed, false);
  assert.deepEqual(data.catalogue.reservedUnreachable, ['ALIAS_DUPLICATE_ANCHOR']);
  assert.equal(data.futureModule.base, '5137a74ec855a32d8a8860eb66b62eb44d11e290');
  assert.equal(data.futureModule.acceptedLength, '74361026502d76b8c2b696f9c60e410ac9b78d95');
  assert.equal(data.futureModule.acceptanceAddendum, '3387a103798bb441764218d38696639d501d19d2');
  assert.equal(data.futureModule.lengthPrerequisiteRemains, false);
  assert.equal(data.futureModule.lengthReplayedHere, false);
  assert.equal(data.futureModule.implementationAuthorized, false);
  assert.deepEqual(data.remainingSemanticAmbiguitiesInTheseCases, []);
}
function validateFrame(frame) {
  assert.deepEqual(Object.keys(frame).sort(), ['bytes', 'hex', 'utf8']);
  assert.equal(typeof frame.utf8, 'string');
  assert(frame.utf8.isWellFormed());
  assert.match(frame.hex, /^(?:[a-f0-9]{2})*$/u);
  assert.equal(frame.bytes, Buffer.byteLength(frame.utf8));
  assert.equal(frame.hex, Buffer.from(frame.utf8).toString('hex'));
}
function validateCases(data) {
  assert.equal(data.recordCount, 32);
  assert.equal(data.cases.length, 32);
  assert.deepEqual(data.defaults.argv, ['-o', 'json', '-c', '.']);
  assert.equal(data.defaults.source, '<stdin>');
  assert.equal(data.defaults.failureFrame, contract.diagnostics.frame.replace('\\n', '\n'));
  const records = new Map();
  const counts = { 'prior-held-witness': 0, 'prior-control': 0, 'new-bounded-control': 0 };
  for (const record of data.cases) {
    assert(!records.has(record.id));
    records.set(record.id, record);
    assert(Object.hasOwn(counts, record.lineage.kind));
    counts[record.lineage.kind]++;
    assert.notEqual(Object.hasOwn(record.input, 'utf8'), Object.hasOwn(record.input, 'hex'));
    if (record.input.utf8 !== undefined) assert(record.input.utf8.isWellFormed());
    else assert.match(record.input.hex, /^(?:[a-f0-9]{2})+$/u);
    if (record.lineage.kind === 'new-bounded-control') assert.equal(record.lineage.refs.length, 0);
    else assert(record.lineage.refs.length > 0);
    for (const reference of record.lineage.refs) {
      assert(prior.has(reference), reference);
      const old = prior.get(reference);
      const oldText = typeof old.input === 'string' ? old.input : old.input?.stdinUtf8;
      if (oldText !== undefined) assert.equal(record.input.utf8, oldText, reference);
      else assert.equal(record.input.hex, old.inputHex ?? old.input?.stdinHex, reference);
    }
    validateFrame(record.expect.stdout);
    if (record.expect.status === 0) {
      validateFrame(record.expect.stderr);
      assert.equal(record.expect.stderr.utf8, '');
      assert(!record.expect.diagnostic);
    } else {
      assert.equal(record.expect.status, 5);
      assert.equal(record.expect.stdout.utf8, '');
      const diagnostic = catalogue.get(record.expect.diagnostic.code);
      assert(diagnostic);
      assert.equal(diagnostic.status, record.expect.status);
      assert.equal(diagnostic.category, record.expect.diagnostic.category);
      assert.notEqual(diagnostic.code, 'ALIAS_DUPLICATE_ANCHOR');
    }
  }
  assert.deepEqual(counts, { 'prior-held-witness': 6, 'prior-control': 7, 'new-bounded-control': 19 });
  assert.equal(data.cases.filter(record => record.expect.status === 0).length, 12);
  const mapped = decisions.crosswalk.flatMap(item => item.cases);
  validateNames([...records.keys()], mapped);
  for (const item of decisions.crosswalk) {
    for (const reference of [...item.prior, ...item.priorControl]) assert(prior.has(reference));
    for (const id of item.cases) assert.equal(records.get(id).decision, item.id);
  }
  assert.deepEqual(records.get('N1-01').expect.documents, [{ 'red blue': 1 }]);
  assert.equal(records.get('N1-01').expect.stdout.utf8, '{"red blue":1}\n');
  assert.equal(records.get('N1-02').expect.stdout.utf8, '"red blue": 1\n');
  assert.deepEqual(records.get('N1-02').argv, []);
  for (const id of ['N1-03', 'N1-04']) assert.equal(records.get(id).expect.diagnostic.code, 'INPUT_YAML_SYNTAX');
  const normalized = records.get('N2-01');
  assert.deepEqual(normalized.expect.numeric, { coefficient: '1', exponent: -1147483646, removedTrailingZeros: 1, exactIntegral: false, doubleText: '0', canonicalText: '1E-1147483646' });
  assert.equal(-1147483647 + normalized.expect.numeric.removedTrailingZeros, normalized.expect.numeric.exponent);
  assert.equal(normalized.expect.stdout.utf8, '1E-1147483646\n');
  assert.equal(Buffer.byteLength(normalized.input.utf8), 15);
  assert.equal(normalized.expect.stdout.bytes, 14);
  for (const id of ['N2-02', 'N2-03', 'N2-04', 'N2-05', 'N2-06']) assert.equal(records.get(id).expect.diagnostic.code, 'SCHEMA_DECIMAL_RANGE');
  assert.equal(records.get('N2-07').expect.stdout.utf8, '0E+999999999\n');
  for (const id of ['N2-08', 'N2-09']) assert.equal(records.get(id).expect.diagnostic.code, 'SCHEMA_UNSAFE_INTEGER');
  for (const [id, point, hex] of [['N3-01', 128640, 'f09f9a80'], ['N3-02', 128578, 'f09f9982']]) {
    const record = records.get(id);
    const scalar = record.expect.scalar;
    assert.equal(scalar.decimal, point);
    assert.equal(scalar.codePoint, `U+${point.toString(16).toUpperCase()}`);
    assert.equal(scalar.utf8Hex, hex);
    assert.equal(scalar.utf8Bytes, 4);
    assert.equal(65536 + (scalar.high - 55296) * 1024 + scalar.low - 56320, point);
    assert.deepEqual(record.expect.documents, [String.fromCodePoint(point)]);
    assert.equal(Buffer.from(record.expect.documents[0]).toString('hex'), hex);
    assert.equal(record.expect.stdout.hex, `22${hex}220a`);
  }
  const refusalClasses = [];
  for (const id of ['N3-03', 'N3-04', 'N3-05', 'N3-06', 'N3-07', 'N3-08']) {
    assert.equal(records.get(id).expect.diagnostic.code, 'INPUT_YAML_SYNTAX');
    refusalClasses.push(records.get(id).expect.refusalClass);
  }
  assert.deepEqual(refusalClasses, ['unpaired', 'unpaired', 'reversed', 'intervening', 'intervening', 'mismatched']);
  assert.equal(records.get('N3-07').input.utf8, '"\\uD83D\\\n  \\uDE80"\n');
  assert.equal(records.get('N3-09').expect.stdout.utf8, '"🚀"\n');
  for (const id of ['N3-10', 'N3-11']) assert.equal(records.get(id).expect.diagnostic.code, 'INPUT_YAML_SYNTAX');
  assert.deepEqual(records.get('N3-12').expect.documents, ['\\uD83D\\uDE80']);
  assert.equal(records.get('N3-13').expect.diagnostic.code, 'INPUT_INVALID_UTF8');
  assert.equal(records.get('N4-01').expect.stdout.utf8, '7\n');
  assert.equal(records.get('N4-02').expect.diagnostic.code, 'SCHEMA_TAG_LEXEME_MISMATCH');
  assert.equal(records.get('N4-03').expect.diagnostic.code, 'SCHEMA_NONFINITE_NUMBER');
  assert.equal(records.get('N4-04').expect.stdout.utf8, '7\n');
  assert.deepEqual(records.get('E-01').argv, []);
  assert.equal(records.get('E-01').expect.stdout.utf8, '"\\u0000"\n');
  assert.equal(records.get('E-01').expect.stdout.hex, '225c7530303030220a');
  assert.equal(records.get('E-01').expect.stdout.bytes, 9);
  assert.equal(records.get('E-02').expect.stdout.utf8, '"\\u0000"\n---\n"\\u0000"\n');
  assert.equal(records.get('E-02').expect.stdout.bytes, 22);
  for (const [id, count] of [['E-01', 1], ['E-02', 2]]) {
    const expected = records.get(id).expect;
    assert.deepEqual(expected.yamlFrame, { documents: count, separators: count - 1, separator: '---\n', finalLf: true });
    assert(!expected.stdout.utf8.includes('\0'));
  }
  return counts;
}
validateDecisions(decisions);
const lineageCounts = validateCases(packet);
let negativeControls = 0;
const rejectMutation = (source, validator, mutate) => {
  const copy = structuredClone(source);
  mutate(copy);
  assert.throws(() => validator(copy));
  negativeControls++;
};
const alter = (data, id) => data.cases.find(record => record.id === id);
rejectMutation(packet, validateCases, data => { alter(data, 'N1-01').expect.documents = [{ redblue: 1 }]; });
rejectMutation(packet, validateCases, data => { alter(data, 'N2-01').expect.numeric.exponent--; });
rejectMutation(packet, validateCases, data => { alter(data, 'N2-05').expect.diagnostic.code = 'SCHEMA_UNSAFE_INTEGER'; });
rejectMutation(packet, validateCases, data => { alter(data, 'N3-01').expect.scalar.utf8Hex = 'f09f9982'; });
rejectMutation(packet, validateCases, data => { alter(data, 'N3-06').expect.refusalClass = 'accepted-after-filter'; });
rejectMutation(packet, validateCases, data => { alter(data, 'N4-01').expect.stdout = { utf8: '7.0\n', hex: '372e300a', bytes: 4 }; });
rejectMutation(packet, validateCases, data => { alter(data, 'E-01').expect.stdout = { utf8: '"\\0"\n', hex: '225c30220a', bytes: 5 }; });
rejectMutation(packet, validateCases, data => { alter(data, 'E-02').expect.stdout.bytes = 21; });
rejectMutation(decisions, validateDecisions, data => { data.resourceDirections.mechanismAccepted = true; });
rejectMutation(decisions, validateDecisions, data => { data.preservedCohorts.rescored = true; });
assert.throws(() => validateNames(['original', 'unlisted-entry/'], ['original']));
negativeControls++;
const corrupted = Buffer.from(selected.get('checkpoint'));
corrupted[0] ^= 1;
assert.throws(() => validateBytes(corrupted, sources.files.find(source => source.id === 'checkpoint')));
negativeControls++;
assert.equal(negativeControls, 12);
const preservedFiles = verifyPreservedTrees();
console.log(JSON.stringify({
  state: 'ADDITIVE_PREPARATION_ONLY_OK', caseRecords: 32, expectedStatusCounts: { success: 12, refusal: 20 },
  lineageCounts, selectedFiles: 9, oldTreeFilesUnchanged: preservedFiles, completeOldTreeMembershipCheckedBeforeAndAfter: true,
  originalCohorts: { freeze: 194, normative: 80, queryBudget: 62 }, rescored: false,
  inMemoryNegativeControls: negativeControls, finiteCatalogueEntries: 54, semanticChoicesRemainingInPacket: 0,
  resourceMechanismAndFinalFreeze: 'PENDING_AUTHOR', originalWRK22Hold: 'RETAINED_UNRESCORED',
  lengthPrerequisiteRemains: false, productExecutions: 0, nativeOrReferenceExecutions: 0,
  typeOrBuildExecutions: 0, independentLengthReplay: 0, writes: 0,
}, null, 2));

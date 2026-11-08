import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = '/Users/kjopek/Workspace/safe-bash';
const prefix = 'tests/commands/yq-independent-20260828';
const authorDirectory = `${prefix}/adopted-n-encoder-v1`;
const reviewDirectory = `${prefix}/adopted-n-encoder-review-v1`;
const candidate = '914d2c9b61f68adc2adf5e4297f702248c2bd5ef';
const parent = '6620463abdf7e952aaa855abfba13159a6c5cc83';
const checkpoint = '544f8279138cb1335ded08f9db638410e91c1324';
const oracleSeal = 'fb84072aab4e5fd75ad4e3e8912a8ddc5c2194f5';
const authorTree = '29898a525d78447fa8f788531ca9c64076684e59';
const authorNames = ['CHECKS.json', 'README.md', 'cases.json', 'check.mjs', 'decisions.json', 'sources.json'];
const preparedNames = ['PROTOCOL.md', 'manifest.json', 'witnesses.json'];
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 8 * 1024 * 1024 });
const text = (...args) => git(...args).toString('utf8').trim();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pinned = (commit, path) => git('show', `${commit}:${path}`);
const json = (commit, path) => JSON.parse(pinned(commit, path));
const frame = utf8 => ({ utf8, hex: Buffer.from(utf8).toString('hex'), bytes: Buffer.byteLength(utf8) });
const argv = ['-o', 'json', '-c', '.'];
assert.equal(process.cwd(), root);
assert.equal(text('rev-parse', '--show-toplevel'), root);
assert.equal(text('show', '-s', '--format=%P', candidate), parent);
assert.equal(text('rev-parse', `${candidate}:${authorDirectory}`), authorTree);
git('merge-base', '--is-ancestor', checkpoint, parent);
git('merge-base', '--is-ancestor', oracleSeal, candidate);
const startHead = text('rev-parse', 'HEAD');
const oracle = json(oracleSeal, `${reviewDirectory}/witnesses.json`);
const manifest = json(oracleSeal, `${reviewDirectory}/manifest.json`);
const packet = json(candidate, `${authorDirectory}/cases.json`);
const decisions = json(candidate, `${authorDirectory}/decisions.json`);
const authorSources = json(candidate, `${authorDirectory}/sources.json`);
const authorClaims = json(candidate, `${authorDirectory}/CHECKS.json`);
const contract = json(checkpoint, 'tests/commands/yq-design-20260828/final-contract-v1/contract.json');
const catalogue = new Map(contract.diagnostics.catalogue.map(entry => [entry.code, entry]));

function identity(commit, path) {
  const bytes = pinned(commit, path);
  const entry = text('ls-tree', commit, '--', path).split('\t')[0].split(' ');
  assert.equal(entry[1], 'blob');
  return { path, mode: entry[0], blob: entry[2], bytes: bytes.length, sha256: digest(bytes) };
}

function verifyFile(commit, path) {
  const expected = identity(commit, path);
  const metadata = lstatSync(`${root}/${path}`);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), path);
  assert.equal(metadata.mode & 0o111 ? '100755' : '100644', expected.mode, path);
  assert.equal(digest(readFileSync(`${root}/${path}`)), expected.sha256, path);
  return expected;
}

function expectedTree(commit, path) {
  return text('ls-tree', '-r', commit, '--', path).split('\n').map(line => {
    const [metadata, filename] = line.split('\t');
    const [mode, kind, blob] = metadata.split(' ');
    assert.equal(kind, 'blob');
    return { path: filename, mode, sha256: digest(git('cat-file', 'blob', blob)) };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function liveTree(path) {
  const entries = [];
  function visit(directory) {
    const metadata = lstatSync(`${root}/${directory}`);
    assert(metadata.isDirectory() && !metadata.isSymbolicLink(), directory);
    for (const entry of readdirSync(`${root}/${directory}`, { withFileTypes: true })) {
      const filename = `${directory}/${entry.name}`;
      assert(!entry.isSymbolicLink(), filename);
      if (entry.isDirectory()) {
        entries.push({ path: filename, mode: '040000', directory: true });
        visit(filename);
      } else {
        const metadata = lstatSync(`${root}/${filename}`);
        assert(metadata.isFile(), filename);
        entries.push({ path: filename, mode: metadata.mode & 0o111 ? '100755' : '100644', sha256: digest(readFileSync(`${root}/${filename}`)) });
      }
    }
  }
  visit(path);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function authenticate() {
  const protectedTrees = manifest.protectedTreesAtCheckpoint.map(binding => {
    for (const commit of [checkpoint, parent, candidate, 'HEAD']) assert.equal(text('rev-parse', `${commit}:${binding.path}`), binding.tree, binding.path);
    const entries = expectedTree(checkpoint, binding.path);
    assert.deepEqual(liveTree(binding.path), entries, `history-membership-mode-content:${binding.path}`);
    if (binding.originalCommit) {
      assert.equal(text('rev-parse', `${binding.originalCommit}:${binding.path}`), binding.originalTree);
      for (const original of expectedTree(binding.originalCommit, binding.path)) assert.deepEqual(entries.find(entry => entry.path === original.path), original);
    }
    return { ...binding, entries };
  });
  const prepared = preparedNames.map(name => verifyFile(oracleSeal, `${reviewDirectory}/${name}`));
  for (const binding of manifest.packet) assert.equal(prepared.find(entry => entry.path.endsWith(`/${binding.path}`)).sha256, binding.sha256);
  const author = authorNames.map(name => verifyFile(candidate, `${authorDirectory}/${name}`));
  assert.deepEqual(liveTree(authorDirectory).map(entry => entry.path).sort(), author.map(entry => entry.path).sort());
  const selectedAuthorFiles = authorSources.files.map(binding => {
    const entry = identity(binding.commit, binding.path);
    assert.equal(entry.sha256, binding.sha256);
    assert.equal(entry.blob, binding.gitBlob);
    assert.equal(entry.bytes, binding.bytes);
    if (binding.compareWorktree) verifyFile(binding.commit, binding.path);
    return { commit: binding.commit, ...entry };
  });
  for (const binding of manifest.selectedFilesAtCheckpoint) {
    const entry = verifyFile(checkpoint, binding.path);
    assert.equal(entry.blob, binding.blob);
    assert.equal(entry.sha256, binding.sha256);
  }
  return { protectedTrees, prepared, author, selectedAuthorFiles };
}

const before = authenticate();
const actualDiff = git('diff', '--binary', parent, candidate);
const changedPaths = text('diff', '--name-only', parent, candidate).split('\n').sort();
assert.deepEqual(changedPaths, [`${prefix}/README.md`, ...authorNames.map(name => `${authorDirectory}/${name}`)].sort());
assert.equal(text('rev-parse', `${parent}:${prefix}/README.md`), text('rev-parse', `${checkpoint}:${prefix}/README.md`));
assert.equal(text('diff', '--name-only', checkpoint, candidate, '--', authorDirectory, `${prefix}/README.md`), text('diff', '--name-only', parent, candidate, '--', authorDirectory, `${prefix}/README.md`));

function accepted(id, input, stdout, metadata = {}, options = argv) {
  return { id, input: { utf8: input }, argv: options, expect: { status: 0, stdout: frame(stdout), stderr: frame(''), ...metadata } };
}

function refused(id, input, code = 'INPUT_YAML_SYNTAX', metadata = {}) {
  return { id, input: typeof input === 'string' ? { utf8: input } : input, argv, expect: { status: 5, stdout: frame(''), diagnostic: { category: code.startsWith('INPUT_') ? 'input' : 'schema', code }, ...metadata } };
}

const expected = [
  accepted('N1-01', '{"red\n  blue": 1}\n', '{"red blue":1}\n', { documents: [{ 'red blue': 1 }] }),
  accepted('N1-02', '{"red\n  blue": 1}\n', '"red blue": 1\n', { documents: [{ 'red blue': 1 }] }, []),
  refused('N1-03', '"red\n  blue": 1\n'),
  refused('N1-04', '["red\n  blue": 1]\n'),
  accepted('N2-01', '10e-1147483647\n', '1E-1147483646\n', { numeric: { coefficient: '1', exponent: -1147483646, removedTrailingZeros: 1, exactIntegral: false, doubleText: '0', canonicalText: '1E-1147483646' } }),
  refused('N2-02', '100e-1147483649\n', 'SCHEMA_DECIMAL_RANGE'),
  refused('N2-03', '1e-1147483647\n', 'SCHEMA_DECIMAL_RANGE'),
  refused('N2-04', '1e999999999999999999999\n', 'SCHEMA_DECIMAL_RANGE'),
  refused('N2-05', '0e1000000000\n', 'SCHEMA_DECIMAL_RANGE'),
  refused('N2-06', '0e-1147483647\n', 'SCHEMA_DECIMAL_RANGE'),
  accepted('N2-07', '0e999999999\n', '0E+999999999\n'),
  refused('N2-08', '90071992547409920e-1\n', 'SCHEMA_UNSAFE_INTEGER'),
  refused('N2-09', '9007199254740991.90\n', 'SCHEMA_UNSAFE_INTEGER'),
  accepted('N3-01', '"\\uD83D\\uDE80"\n', '"🚀"\n', { documents: ['🚀'], scalar: { codePoint: 'U+1F680', decimal: 128640, utf8Hex: 'f09f9a80', utf8Bytes: 4, high: 55357, low: 56960 } }),
  accepted('N3-02', '"\\uD83D\\uDE42"\n', '"🙂"\n', { documents: ['🙂'], scalar: { codePoint: 'U+1F642', decimal: 128578, utf8Hex: 'f09f9982', utf8Bytes: 4, high: 55357, low: 56898 } }),
  refused('N3-03', '"\\uD800"\n', 'INPUT_YAML_SYNTAX', { refusalClass: 'unpaired' }),
  refused('N3-04', '"\\uDC00"\n', 'INPUT_YAML_SYNTAX', { refusalClass: 'unpaired' }),
  refused('N3-05', '"\\uDE80\\uD83D"\n', 'INPUT_YAML_SYNTAX', { refusalClass: 'reversed' }),
  refused('N3-06', '"\\uD83Dx\\uDE80"\n', 'INPUT_YAML_SYNTAX', { refusalClass: 'intervening' }),
  refused('N3-07', '"\\uD83D\\\n  \\uDE80"\n', 'INPUT_YAML_SYNTAX', { refusalClass: 'intervening' }),
  refused('N3-08', '"\\uD83D\\uD83D"\n', 'INPUT_YAML_SYNTAX', { refusalClass: 'mismatched' }),
  accepted('N3-09', '"\\U0001F680"\n', '"🚀"\n', { documents: ['🚀'] }),
  refused('N3-10', '"\\U0000D800"\n', 'INPUT_YAML_SYNTAX', { refusalClass: 'unchanged-U-surrogate' }),
  refused('N3-11', '"\\U00110000"\n', 'INPUT_YAML_SYNTAX', { refusalClass: 'unchanged-U-out-of-range' }),
  accepted('N3-12', "'\\uD83D\\uDE80'\n", '"\\\\uD83D\\\\uDE80"\n', { documents: ['\\uD83D\\uDE80'] }),
  refused('N3-13', { hex: '22eda080220a' }, 'INPUT_INVALID_UTF8'),
  accepted('N4-01', '!!float 7\n', '7\n', { documents: [7] }),
  refused('N4-02', '!!int 7.0\n', 'SCHEMA_TAG_LEXEME_MISMATCH'),
  refused('N4-03', '!!float .NaN\n', 'SCHEMA_NONFINITE_NUMBER'),
  accepted('N4-04', '!!int 7\n', '7\n', { documents: [7] }),
  accepted('E-01', '"\\0"\n', '"\\u0000"\n', { documents: ['\0'], yamlFrame: { documents: 1, separators: 0, separator: '---\n', finalLf: true } }, []),
  accepted('E-02', '"\\0"\n---\n"\\0"\n', '"\\u0000"\n---\n"\\u0000"\n', { documents: ['\0', '\0'], yamlFrame: { documents: 2, separators: 1, separator: '---\n', finalLf: true } }, []),
];

function validateAuthor(data) {
  assert.equal(data.recordCount, 32);
  assert.deepEqual(data.defaults.argv, argv);
  assert.equal(data.defaults.failureFrame, contract.diagnostics.frame.replace('\\n', '\n'));
  assert.deepEqual(data.cases.map(record => record.id), expected.map(record => record.id));
  for (const golden of expected) {
    const actual = data.cases.find(record => record.id === golden.id);
    assert.deepEqual(actual.input, golden.input, `${golden.id}:input`);
    assert.deepEqual(actual.argv ?? data.defaults.argv, golden.argv, `${golden.id}:argv`);
    assert.equal(actual.decision, golden.id.startsWith('E-') ? 'B-ENCODER-ESCAPE-SPELLING' : golden.id.split('-')[0]);
    assert.deepEqual(actual.expect, golden.expect, `${golden.id}:expected-tuple`);
  }
}

function validateWitnesses(data) {
  assert.deepEqual(data.witnesses.map(record => record.id), oracle.witnesses.map(record => record.id));
  for (const golden of oracle.witnesses) assert.deepEqual(data.witnesses.find(record => record.id === golden.id), golden, `${golden.id}:presealed-independent-expectation`);
}

function validateResources(data) {
  assert.equal(data.implementationAuthorized, false, 'no-implementation-authorization');
  const resource = data.resourceDirections;
  assert.equal(resource.mechanismAccepted, false, 'no-resource-acceptance');
  assert.equal(resource.finalResourceFreezeComplete, false, 'no-final-resource-freeze');
  for (const key of ['newYqOwnedAsyncTraversal', 'ownedCheckpointsRequired', 'newFilesOnly', 'existingInternalSyncPhasesStillQualified']) assert.equal(resource['QB-F1'][key], true, `QB-F1:${key}`);
  assert.equal(resource['QB-F1'].broadRefactor, false);
  for (const key of ['wholeCopyPreadmission', 'includesCheckpointCharges', 'estimationSeparatelyCharged', 'actualPrivateBudgetAdmissionBeforeCopy', 'consumeOnce']) assert.equal(resource['QB-F2'][key], true, `QB-F2:${key}`);
  for (const key of ['refunds', 'newBudgetPerAliasOrDocument', 'interleavedQueryConsumption']) assert.equal(resource['QB-F2'][key], false, `QB-F2:${key}`);
}

validateAuthor(packet);
validateWitnesses(oracle);
validateResources(decisions);
assert.equal(expected.filter(record => record.expect.status === 0).length, 12);
assert.deepEqual(packet.cases.reduce((counts, record) => ({ ...counts, [record.lineage.kind]: (counts[record.lineage.kind] ?? 0) + 1 }), {}), { 'prior-held-witness': 6, 'new-bounded-control': 19, 'prior-control': 7 });
assert.equal(-1147483647 + 1, -1147483646);
assert.equal(-1147483649 + 2, -1147483647);
assert.equal(Number('9007199254740991.9'), 9007199254740992);
for (const golden of expected) {
  if (golden.expect.scalar) {
    const scalar = golden.expect.scalar;
    assert.equal(0x10000 + (scalar.high - 0xd800) * 0x400 + scalar.low - 0xdc00, scalar.decimal);
    assert.equal(Buffer.from(String.fromCodePoint(scalar.decimal)).toString('hex'), scalar.utf8Hex);
  }
  if (golden.expect.diagnostic) assert.equal(catalogue.get(golden.expect.diagnostic.code).category, golden.expect.diagnostic.category);
}
for (const witness of oracle.witnesses) {
  if ('value' in witness.expect) assert.deepEqual(JSON.parse(witness.expect.jsonPayloadUtf8), witness.expect.value);
  for (const format of ['json', 'yaml']) if (witness.expect[`${format}PayloadHex`]) assert.equal(Buffer.from(witness.expect[`${format}PayloadUtf8`]).toString('hex'), witness.expect[`${format}PayloadHex`]);
}

const relations = [
  ['W01', 'structural-analogue', ['N1-01']], ['W02', 'independent-only-folding-guard', []],
  ['W03', 'structural-analogue', ['N1-03']], ['W04', 'exact-input-and-mode', ['N2-01']],
  ['W05', 'exact-input-and-mode', ['N2-06']], ['W06', 'structural-analogue', ['N2-03']],
  ['W07', 'structural-analogue', ['N2-04', 'N2-05', 'N2-06']], ['W08', 'structural-analogue', ['N3-01', 'N3-02']],
  ['W09', 'structural-analogue', ['N3-03']], ['W10', 'structural-analogue', ['N3-04']],
  ['W11', 'structural-analogue', ['N3-05']], ['W12', 'structural-analogue', ['N3-06']],
  ['W13', 'structural-analogue', ['N3-08']], ['W14', 'structural-analogue', ['N3-09']],
  ['W15', 'exact-input-and-mode', ['N4-01']], ['W16', 'exact-input-and-mode', ['N4-02']],
  ['W17', 'structural-analogue', ['E-01']], ['W18', 'structural-analogue', ['N3-12']],
].map(([id, relationship, authorIds]) => {
  const witness = oracle.witnesses.find(record => record.id === id);
  if (relationship === 'exact-input-and-mode') {
    const actual = packet.cases.find(record => record.id === authorIds[0]);
    assert.equal(actual.input.utf8, witness.inputUtf8);
    if (witness.expect.kind === 'accept') assert.equal(actual.expect.stdout.utf8, `${witness.expect.jsonPayloadUtf8}\n`);
    else assert.deepEqual(actual.expect.diagnostic, { category: witness.expect.category, code: witness.expect.code });
  }
  return { id, relationship, authorIds, presealedExpectationUnchanged: true, runtimeExecuted: false };
});

const mutations = [];
function rejectMutation(family, name, source, validator, mutate) {
  const copy = structuredClone(source);
  mutate(copy);
  const refreshedHash = digest(JSON.stringify(copy));
  assert.equal(digest(JSON.stringify(copy)), refreshedHash);
  let failure;
  try { validator(copy); } catch (error) { failure = error; }
  assert(failure instanceof assert.AssertionError, `${family}:${name}:mutation-not-rejected`);
  mutations.push({ family, name, detected: true, failure: failure.message.split('\n')[0], refreshedSemanticDataSha256: refreshedHash, staleHashWasNotDetection: true });
}
const authorRecord = (data, id) => data.cases.find(record => record.id === id);
const witnessRecord = (data, id) => data.witnesses.find(record => record.id === id);
const mutateOutput = (family, name, id, stdout) => rejectMutation(family, name, packet, validateAuthor, data => { authorRecord(data, id).expect.stdout = frame(stdout); });
for (const [name, payload] of [['short-zero', '"\\0"'], ['hex-zero', '"\\x00"'], ['raw-NUL', '"\0"'], ['doubled-backslash', '"\\\\u0000"']]) mutateOutput('M-NUL', name, 'E-01', `${payload}\n`);
rejectMutation('M-NUL', 'literal-text-becomes-NUL', oracle, validateWitnesses, data => { witnessRecord(data, 'W18').expect = structuredClone(witnessRecord(data, 'W17').expect); });
rejectMutation('M-NUL', 'framing-LF-inside-payload', oracle, validateWitnesses, data => { const expected = witnessRecord(data, 'W17').expect; expected.jsonPayloadUtf8 += '\n'; expected.jsonPayloadHex = Buffer.from(expected.jsonPayloadUtf8).toString('hex'); });
mutateOutput('M-FLOW', 'single-break-kept-LF', 'N1-01', '{"red\\nblue":1}\n');
rejectMutation('M-FLOW', 'blank-line-folded-space', oracle, validateWitnesses, data => { const expected = witnessRecord(data, 'W02').expect; expected.value = { 'copper finch': 4 }; expected.jsonPayloadUtf8 = '{"copper finch":4}'; });
rejectMutation('M-FLOW', 'blanket-flow-key-refusal', packet, validateAuthor, data => { authorRecord(data, 'N1-01').expect = refused('', '').expect; });
rejectMutation('M-FLOW', 'block-key-accepted', packet, validateAuthor, data => { authorRecord(data, 'N1-03').expect = accepted('', '', '{"red blue":1}\n', { documents: [{ 'red blue': 1 }] }).expect; });
rejectMutation('M-RANGE', 'raw-lower-bound-veto', packet, validateAuthor, data => { authorRecord(data, 'N2-01').expect = refused('', '', 'SCHEMA_DECIMAL_RANGE').expect; });
mutateOutput('M-RANGE', 'nonzero-projected-to-zero', 'N2-01', '0\n');
for (const [name, id] of [['zero-clamping', 'N2-06'], ['decimal-rounding', 'N2-03'], ['raw-token-loss', 'N2-04']]) rejectMutation('M-RANGE', name, packet, validateAuthor, data => { authorRecord(data, id).expect = accepted('', '', '0\n').expect; });
rejectMutation('M-PAIR', 'valid-pair-rejected', packet, validateAuthor, data => { authorRecord(data, 'N3-01').expect = refused('', '').expect; });
for (const id of ['N3-03', 'N3-04', 'N3-05', 'N3-06', 'N3-08']) rejectMutation('M-PAIR', `refusal-accepted:${id}`, packet, validateAuthor, data => { authorRecord(data, id).expect = accepted('', '', '"🚀"\n', { documents: ['🚀'] }).expect; });
mutateOutput('M-PAIR', 'U-scalar-changed', 'N3-09', '"🙂"\n');
rejectMutation('M-TAG', 'implicit-first-float-veto', packet, validateAuthor, data => { authorRecord(data, 'N4-01').expect = refused('', '', 'SCHEMA_TAG_LEXEME_MISMATCH').expect; });
rejectMutation('M-TAG', 'integer-coercion', packet, validateAuthor, data => { authorRecord(data, 'N4-02').expect = accepted('', '', '7\n', { documents: [7] }).expect; });
const history = before.protectedTrees.flatMap(tree => tree.entries);
const validateHistory = data => assert.deepEqual(data, history, 'protected-tree-membership-mode-content');
rejectMutation('M-HISTORY', 'old-content-byte', history, validateHistory, data => { data[0].sha256 = digest('synthetic one-byte mutation'); });
rejectMutation('M-HISTORY', 'added-filename', history, validateHistory, data => { data.push({ path: `${prefix}/freeze/unlisted-synthetic-control`, mode: '100644', sha256: digest('') }); });
rejectMutation('M-HISTORY', 'deleted-file', history, validateHistory, data => { data.shift(); });
rejectMutation('M-HISTORY', 'changed-mode', history, validateHistory, data => { data[0].mode = '100755'; });
const symbolicCopy = { remainingAfterChargedEstimate: 1024, copyUnits: 1024, minimumCheckpointCharges: 1, admitted: false };
const validateCopy = data => assert.equal(data.admitted, data.copyUnits + data.minimumCheckpointCharges <= data.remainingAfterChargedEstimate, 'whole-copy-checkpoint-preadmission');
validateCopy(symbolicCopy);
rejectMutation('M-RESOURCE', 'step-1024-only-admission', symbolicCopy, validateCopy, data => { data.admitted = true; });
for (const [name, key, value] of [['free-estimation', 'estimationSeparatelyCharged', false], ['double-charge', 'consumeOnce', false], ['refund', 'refunds', true], ['alias-document-Budget', 'newBudgetPerAliasOrDocument', true], ['query-interleaving', 'interleavedQueryConsumption', true]]) rejectMutation('M-RESOURCE', name, decisions, validateResources, data => { data.resourceDirections['QB-F2'][key] = value; });
rejectMutation('M-RESOURCE', 'sync-helper-yield-claim', decisions, validateResources, data => { data.resourceDirections['QB-F1'].existingInternalSyncPhasesStillQualified = false; });
rejectMutation('M-RESOURCE', 'premature-acceptance', decisions, validateResources, data => { data.resourceDirections.mechanismAccepted = true; });
assert.equal(mutations.length, 36);
assert.deepEqual([...new Set(mutations.map(entry => entry.family))].sort(), oracle.negativeControls.map(entry => entry.id).sort());

const checkerPaths = [
  `${prefix}/freeze/verify-preparation.mjs`, `${prefix}/normative/check-static.mjs`,
  `${prefix}/query-budget/check.mjs`, `${prefix}/reconciliation-v1/check.mjs`, `${authorDirectory}/check.mjs`,
];
const recipeHelper = verifyFile(candidate, `${prefix}/freeze/recipes.mjs`);
const runs = checkerPaths.map(path => {
  const checker = verifyFile(candidate, path);
  const historicalClaim = authorClaims.checks.find(entry => entry.command === `node ${path}`);
  if (historicalClaim) assert.equal(checker.sha256, historicalClaim.checkerSha256);
  const run = spawnSync(process.execPath, [path], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120000, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
  assert.ifError(run.error);
  return { command: `node ${path}`, checker, exitStatus: run.status, signal: run.signal, stdout: run.stdout, stderr: run.stderr, stdoutSha256: digest(run.stdout), inheritedAuthorSuccessUsed: false };
});
const after = authenticate();
assert.deepEqual(after, before, 'before-after-authentication');
const ownPath = fileURLToPath(import.meta.url);
const ancestorDiff = git('diff', '--name-status', checkpoint, parent);
console.log(JSON.stringify({
  schemaVersion: 1, date: '2026-08-28', state: runs.every(run => run.exitStatus === 0) ? 'BOUNDED_STATIC_REVIEW_CONSISTENT' : 'STATIC_CHECKER_FAILURE',
  candidate, parent, authorTree, oracleSeal, checkpoint, startHead, endHead: text('rev-parse', 'HEAD'), nodeVersion: process.version,
  executionMode: 'authenticated-byte-identical-worktree-checkers; independent comparator reads committed Git inputs',
  reviewerChecker: { path: ownPath.slice(root.length + 1), sha256: digest(readFileSync(ownPath)) },
  authorDiff: { sha256: digest(actualDiff), bytes: actualDiff.length, changedPaths, umbrellaIndexOnlyOutsidePacket: true },
  checkpointToActualParent: { statusDiffSha256: digest(ancestorDiff), changedPathCount: ancestorDiff.toString().trim().split('\n').length, unrelatedAncestorContentsNotAudited: true },
  authenticationBefore: before, authenticationAfter: after, completeProtectedMembershipAndGitModesCheckedBeforeAfter: true,
  protectedHistoryFiles: history.length, originalCohorts: { counts: [194, 80, 62], overlap: true, rescored: false },
  preparedFilesChanged: false, witnessRelations: relations,
  witnessSummary: { retained: 18, exactAuthorInputs: 4, structuralAnalogues: 13, independentOnlyGuards: 1, runtimePasses: null },
  authorComparisons: expected.map(record => ({ id: record.id, input: record.input, expected: record.expect, result: 'EXPECTED_TUPLE_MATCH', authorField: `/cases/${packet.cases.findIndex(actual => actual.id === record.id)}/expect` })),
  authorSummary: { examined: 32, expectedAccept: 12, expectedRefuse: 20, priorHeld: 6, priorControls: 7, newBoundedControls: 19, tupleMismatches: 0, runtimePasses: null },
  mutations, mutationSummary: { families: 7, detected: 36, undetected: 0, scope: 'in-memory static expected-tuple/invariant rejection, not parser or product mutation tests' },
  checkerSafetyReview: { productModulesImported: false, soleLocalHelper: recipeHelper, nestedProcesses: 'Git read-only commands only', sourceReads: 'pinned static source data, never imported', writes: false },
  freshCheckerRuns: runs,
  resourceChronology: { candidateSealText: 'pending author mechanism', currentRootStatement: 'precise proposal 89e403e0 + 6620463a available; independent QB review pending', separateReview: 'qb-mechanism-review-v1', proposalContentsRead: false, mechanismAudited: false, mechanismAccepted: false, finalFreezeClaimed: false },
  unresolvedFixtureIssues: [], limitations: ['No product/native/parser execution or new case breadth.', 'W02 has no identical author fixture; it remains a presealed independent folding guard.', 'Diagnostic category/code/status checked; exact truthful source/location suffix remains unfrozen.', 'Current QB proposal is separate review, not an N-packet defect.', 'Legacy hold/pending labels are historical checker outputs, not rescoring.'],
  productExecutions: 0, nativeOracleExecutions: 0, typeOrBuildExecutions: 0, dependenciesAdded: 0, implementationAuthorized: false,
}, null, 2));
if (runs.some(run => run.exitStatus !== 0)) process.exitCode = 1;

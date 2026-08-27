import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
assert.equal(root, '/Users/kjopek/Workspace/safe-bash');
const mode = process.argv[2] ?? '--check';
assert.ok(['--check', '--write'].includes(mode));
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(Array.isArray(value) ? value.map(sortValue) : sortValue(value));
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortValue(value[key])]));
  return value;
}
const digest = value => hash(canonical(value));
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
const refs = {
  curie: '8e09db96b51248137648cd5fd6093e4bc08f2b59',
  curieDocumentation: 'd484f98745494099e57740c8c0ad673b65e0a2aa',
  frozenProduct: 'bd2cacb3a20403302fd0a49441932d5522793e56',
  aligned: 'd1b10a375a13f031f9f604a64395cd507f21a071',
  replay: '245799e7498c849098ca971fe00270112aa5e06e',
  faraday: '849dbf18b1e865c7d12927c11f0e20ba0555c540',
  faradayReview: 'e0325b590b593fbe5fd17b2b1b778fe8badb25f0',
};
for (const revision of Object.values(refs)) assert.equal(git(['rev-parse', revision]).toString().trim(), revision);
const expanded = 'benchmarks/reports/expanded-20260827';
const replay = 'benchmarks/reports/current-integration/comparison-replay-20260827';
const breadth = 'benchmarks/reports/baseline-only-20260827';
const author = `${breadth}/coverage-execution`;
const reviewer = `${breadth}/coverage-review/measured`;
const artifactSets = [
  { id: 'curie-expanded-snapshot', revision: refs.curie, paths: [expanded, 'benchmarks/expanded'] },
  { id: 'curie-documentation', revision: refs.curieDocumentation, paths: ['README.md', 'docs/PROJECT_LEDGER.md', 'AGENTS.md'] },
  { id: 'aligned-capture-and-harness', revision: refs.aligned, paths: [`${expanded}/native-scratch-aligned`, `${expanded}/scratch-aligned-controls`, `${expanded}/SCRATCH_PROFILE_DELTA.md`, 'benchmarks/expanded'] },
  { id: 'historical-replay-and-fairness', revision: refs.replay, paths: [replay, 'benchmarks/reports/comparison-fairness-20260827'] },
  { id: 'faraday-author-artifact-set', revision: refs.faraday, paths: [author] },
  { id: 'faraday-review-artifact-set', revision: refs.faradayReview, paths: [reviewer] },
  { id: 'faraday-setup-and-original-inventory', revision: refs.faraday, paths: [`${breadth}/coverage-setup`, `${expanded}/baseline-only-frozen`] },
];
const buffers = new Map();
const artifacts = [];
for (const set of artifactSets) {
  const lines = git(['ls-tree', '-rl', set.revision, '--', ...set.paths]).toString().trim().split('\n').filter(Boolean);
  set.artifacts = lines.map(line => {
    const match = /^(\d+) blob ([0-9a-f]+)\s+(\d+)\t(.+)$/.exec(line);
    assert.ok(match, line);
    const [, fileMode, blob, byteLength, path] = match;
    const artifact = { set: set.id, revision: set.revision, path, fileMode, gitBlob: blob, bytes: Number(byteLength) };
    artifacts.push(artifact);
    return artifact;
  });
  assert.ok(set.artifacts.length);
}
const blobs = [...new Set(artifacts.map(artifact => artifact.gitBlob))];
const batch = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: `${blobs.join('\n')}\n`, maxBuffer: 256 * 1024 * 1024 });
let offset = 0;
for (const blob of blobs) {
  const headerEnd = batch.indexOf(10, offset);
  const [returned, type, length] = batch.subarray(offset, headerEnd).toString().split(' ');
  assert.equal(returned, blob);
  assert.equal(type, 'blob');
  const buffer = batch.subarray(headerEnd + 1, headerEnd + 1 + Number(length));
  assert.equal(buffer.length, Number(length));
  buffers.set(blob, buffer);
  offset = headerEnd + 2 + Number(length);
}
assert.equal(offset, batch.length);
for (const artifact of artifacts) artifact.sha256 = hash(buffers.get(artifact.gitBlob));
function artifact(revision, path) {
  const found = artifacts.find(item => item.revision === revision && item.path === path);
  assert.ok(found, `Missing artifact: ${revision}:${path}`);
  return found;
}
function captured(revision, path) {
  return JSON.parse(buffers.get(artifact(revision, path).gitBlob));
}
function reference(revision, path, pointer = '') {
  const found = artifact(revision, path);
  return { revision, path, gitBlob: found.gitBlob, fileSha256: found.sha256, pointer };
}
const originalNative = captured(refs.curie, `${expanded}/native-corrected/native.json`);
const alignedNative = captured(refs.aligned, `${expanded}/native-scratch-aligned/native.json`);
const historicalRows = captured(refs.curie, `${expanded}/corrected-bd2cacb/functional.json`);
const historicalReport = captured(refs.curie, `${expanded}/corrected-bd2cacb/report.json`);
const originalRows = captured(refs.replay, `${replay}/original/functional.json`);
const alignedRows = captured(refs.replay, `${replay}/scratch-aligned/functional.json`);
const replaySummary = captured(refs.replay, `${replay}/summary.json`);
const replayProfiles = captured(refs.replay, `${replay}/profiles.json`);
const breadthInput = captured(refs.faraday, `${author}/attempt-002/execution-inputs.json`);
const breadthFirst = captured(refs.faraday, `${author}/attempt-001/execution-inputs.json`);
const breadthMatrix = captured(refs.faraday, `${author}/attempt-002/matrix.json`);
const reviewMatrix = captured(refs.faradayReview, `${reviewer}/review-matrix.json`);
const continuation = captured(refs.faradayReview, `${reviewer}/continuation/results.json`);
assert.equal(originalNative.recipes.length, 224);
assert.equal(originalNative.observations.length, 228);
assert.deepEqual(originalNative.recipes, alignedNative.recipes);
assert.deepEqual(originalNative.performanceRecipes, alignedNative.performanceRecipes);
for (const profile of ['original', 'scratch-aligned']) assert.deepEqual(originalNative.recipes, captured(refs.replay, `${replay}/${profile}/case-inputs.json`));
const unique = rows => assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
for (const rows of [originalNative.recipes, historicalRows, originalRows, alignedRows, breadthInput.cases, breadthInput.diagnostics]) unique(rows);
const profileIds = {
  original: 'expanded-original-mixed-gnu-darwin',
  aligned: 'expanded-scratch-aligned-mixed-gnu-darwin',
  breadth: 'faraday-attempt002-predetermined-intent-not-native',
};
function countBy(rows, field) {
  const result = {};
  for (const row of rows) result[row[field]] = (result[row[field]] ?? 0) + 1;
  return result;
}
function score(rows, engine) {
  return countBy(rows.map(row => row[engine]), 'status');
}
function oldInput(row) {
  return { cwd: '/fixture', files: row.files, stdinBase64: row.stdin, directories: row.directories, fileModes: row.fileModes, fileTimes: row.fileTimes, symlinks: {} };
}
function breadthInputShape(row) {
  return { cwd: row.cwd, files: Object.fromEntries(Object.entries(row.files).map(([path, file]) => [path, file.base64])), stdinBase64: row.stdinBase64, directories: row.directories, fileModes: Object.fromEntries(Object.entries(row.files).filter(([, file]) => file.mode !== undefined).map(([path, file]) => [path, file.mode])), fileTimes: {}, symlinks: row.symlinks };
}
function byteAssets(input) {
  return [{ role: 'stdin', bytes: Buffer.from(input.stdinBase64, 'base64') }, ...Object.entries(input.files).map(([path, value]) => ({ role: `file:${path}`, bytes: Buffer.from(value, 'base64') }))].map(({ role, bytes }) => ({ role, byteLength: bytes.length, sha256: hash(bytes) }));
}
function descriptor(id, target, script, input, profile, extra = {}) {
  const tokens = [...new Set(script.match(/[A-Za-z_][A-Za-z0-9_.-]*/g) ?? [])].sort();
  const byteShape = { cwd: input.cwd, files: input.files, stdinBase64: input.stdinBase64 };
  return { id, declaredTarget: target, scriptSha256: hash(script), byteInputSha256: digest(byteShape), fullFixtureSha256: digest(input), scriptAndByteInputSha256: digest({ script, ...byteShape }), fullRecipeProfileSha256: digest({ script, input, profile, extra }), profile, lexicalTokens: tokens, literalPipeCharacterCount: [...script].filter(character => character === '|').length, literalRedirectCharacterCount: [...script].filter(character => character === '>').length, assets: byteAssets(input) };
}
const oldCases = originalNative.recipes.map((recipe, index) => {
  const expected = originalNative.observations.find(row => row.id === recipe.id);
  const alignedExpected = alignedNative.observations.find(row => row.id === recipe.id);
  const oldRow = historicalRows.find(row => row.id === recipe.id);
  const replayRow = originalRows.find(row => row.id === recipe.id);
  const alignedRow = alignedRows.find(row => row.id === recipe.id);
  assert.equal(hash(JSON.stringify(recipe)), expected.recipeHash);
  assert.deepEqual(oldRow.expected, expected);
  assert.deepEqual(replayRow.expected, expected);
  assert.deepEqual(alignedRow.expected, alignedExpected);
  return {
    id: recipe.id, recipe, recipeCanonicalSha256: digest(recipe), capturedRecipeHash: expected.recipeHash,
    input: oldInput(recipe), inputCanonicalSha256: digest(oldInput(recipe)),
    staticCoverage: descriptor(recipe.id, recipe.command, recipe.script, oldInput(recipe), profileIds.original, { network: recipe.network }),
    recipeReference: reference(refs.curie, `${expanded}/native-corrected/native.json`, `/recipes/${index}`),
    originalOracle: { profile: profileIds.original, observation: expected, canonicalSha256: digest(expected) },
    alignedOracle: { profile: profileIds.aligned, observation: alignedExpected, canonicalSha256: digest(alignedExpected) },
    historicalResults: { frozenBd2cac: { 'virtual-bash': oldRow['virtual-bash'], 'just-bash': oldRow['just-bash'] }, replayOriginal: { 'virtual-bash': replayRow['virtual-bash'], 'just-bash': replayRow['just-bash'] }, replayAligned: { 'virtual-bash': alignedRow['virtual-bash'], 'just-bash': alignedRow['just-bash'] } },
  };
});
const oracleDeltas = originalNative.observations.flatMap(before => {
  const after = alignedNative.observations.find(row => row.id === before.id);
  assert.ok(after);
  if (canonical(before) === canonical(after)) return [];
  return [{ id: before.id, changedFields: [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => canonical(before[key]) !== canonical(after[key])), before, after }];
});
assert.equal(oracleDeltas.length, 1);
assert.equal(oracleDeltas[0].id, 'command/patch/dry-run');
assert.deepEqual(oracleDeltas[0].changedFields, ['entries']);
const actualProfileDeltas = [];
for (const row of originalRows) for (const engine of ['virtual-bash', 'just-bash']) {
  const other = alignedRows.find(item => item.id === row.id)[engine];
  const select = value => {
    assert.equal(typeof value.observation.stdout, 'string');
    assert.equal(typeof value.observation.stderr, 'string');
    assert.equal(typeof value.observation.exitCode, 'number');
    assert.ok(value.observation.entries);
    return { stdout: value.observation.stdout, stderr: value.observation.stderr, exitCode: value.observation.exitCode, entries: value.observation.entries };
  };
  if (canonical(select(row[engine])) !== canonical(select(other))) actualProfileDeltas.push({ id: row.id, engine });
}
assert.equal(actualProfileDeltas.length, 0);
const breadthCases = [...breadthInput.cases, ...breadthInput.diagnostics].map((recipe, index) => {
  const reviewed = reviewMatrix.observations.find(row => row.id === recipe.id);
  assert.ok(reviewed);
  const section = index < breadthInput.cases.length ? 'cases' : 'diagnostics';
  const sectionIndex = section === 'cases' ? index : index - breadthInput.cases.length;
  const input = breadthInputShape(recipe);
  const rawEvidence = {};
  for (const engine of ['ours', 'baseline']) {
    const authorRaw = `${author}/attempt-002/raw/${recipe.id}.${engine}.json`;
    const reviewRaw = reviewed[engine].raw;
    rawEvidence[engine] = { author: reference(refs.faraday, authorRaw), review: reference(refs.faradayReview, reviewRaw) };
    assert.equal(rawEvidence[engine].review.fileSha256, reviewed[engine].rawSha256);
  }
  return { id: recipe.id, section, recipe, recipeCanonicalSha256: digest(recipe), input, inputCanonicalSha256: digest(input), staticCoverage: descriptor(recipe.id, recipe.name, recipe.effectiveScript, input, profileIds.breadth, { configuration: recipe.configuration, env: recipe.env, globalEnvironment: breadthInput.environment }), recipeReference: reference(refs.faraday, `${author}/attempt-002/execution-inputs.json`, `/${section}/${sectionIndex}`), oracle: { kind: 'predetermined-workflow-intent-NOT-native-golden', expected: recipe.expected, canonicalSha256: digest(recipe.expected) }, review: reviewed, rawEvidence };
});
assert.equal(breadthCases.length, 68);
assert.equal(continuation.observations.length, 136);
assert.equal(new Set(continuation.observations.map(row => `${row.caseId}:${row.engine}`)).size, 136);
const defaults = breadthCases.filter(row => row.recipe.cohort === 'historical-unmeasured');
const optional = breadthCases.filter(row => row.recipe.cohort === 'additional-optional');
assert.equal(defaults.length, 50);
assert.equal(optional.length, 4);
const exactPositives = (rows, engine) => rows.filter(row => row.review[engine].operationalCredit).length;
assert.equal(exactPositives([...defaults, ...optional], 'baseline'), 47);
assert.equal(exactPositives([...defaults, ...optional], 'ours'), 0);
assert.equal(reviewMatrix.dispatchEvidence.length, 54);
assert.equal(reviewMatrix.dispatchEvidence.filter(row => row.missingConfirmed).length, 54);
const preparationDeltas = breadthCases.map(row => {
  const before = [...breadthFirst.cases, ...breadthFirst.diagnostics].find(item => item.id === row.id);
  return { id: row.id, added: !before, changedFields: before ? [...new Set([...Object.keys(before), ...Object.keys(row.recipe)])].filter(key => canonical(before[key]) !== canonical(row.recipe[key])) : [], beforeCanonicalSha256: before ? digest(before) : null, afterCanonicalSha256: row.recipeCanonicalSha256 };
}).filter(row => row.added || row.changedFields.length);
const publicPaths = ['README.md', 'src/commands/stream-inspection/README.md', 'src/commands/stream-format/README.md', 'src/commands/split/README.md', 'src/commands/time-env/README.md', 'docs/integration/2026-08-27-TIME_ENV_PUBLIC.md'];
const publicSnapshotPath = resolve(owned, 'public-profile-snapshot.json');
const publicSnapshot = existsSync(publicSnapshotPath) ? JSON.parse(readFileSync(publicSnapshotPath)) : {
  classification: 'public-documentation-only; no implementation/test inspection for new design',
  documents: publicPaths.map(path => { const bytes = readFileSync(resolve(root, path)); return { path, sha256: hash(bytes), byteLength: bytes.length, utf8: bytes.toString('utf8') }; }),
};
for (const document of publicSnapshot.documents) assert.equal(hash(document.utf8), document.sha256);
const encode = text => Buffer.from(text).toString('base64');
const holdoutSpecifications = [
  ['tac', 'append-log', 'tac log | cat > newest', { log: 'earlier\nlater\n' }, '', ['newest'], 'Reverse a two-record VFS log through an internal pipe.'],
  ['tac', 'literal-records', "tac -s '::' records > reversed", { records: 'one::two::three::' }, '', ['reversed'], 'Reverse literal multi-byte separators without a regex profile.'],
  ['expand', 'indent-only', 'expand -i -t 4 source | cat > readable', { source: '\tfirst\tvalue\n  \tsecond\n' }, '', ['readable'], 'Expand leading indentation while retaining later tabs.'],
  ['expand', 'finite-tab-stops', 'expand -t 3,7 source > columns', { source: 'a\tb\tc\n' }, '', ['columns'], 'Exercise finite C-byte tab columns with a VFS operand.'],
  ['fold', 'byte-wrap', 'fold -b -w 5 input | cat > wrapped', { input: 'abcdefghijk\n' }, '', ['wrapped'], 'Wrap fixed-byte records and preserve the short tail.'],
  ['fold', 'word-wrap', 'fold -s -w 9 words > wrapped', { words: 'red blue green\n' }, '', ['wrapped'], 'Prefer blanks at bounded wrap positions.'],
  ['strings', 'binary-file', 'strings -a -n 4 payload | cat > labels', { payload: Buffer.from([0, 65, 76, 80, 72, 65, 0, 255, 66, 69, 84, 65, 10]) }, '', ['labels'], 'Extract printable labels from a binary VFS payload.'],
  ['strings', 'stdin-offsets', 'strings -a -n 3 -t d > offsets', {}, Buffer.from([0, 97, 98, 99, 0, 100, 101, 102, 0]), ['offsets'], 'Record decimal offsets from raw stdin without object parsing.'],
  ['seq', 'decimal-series', 'seq 0.5 0.5 2 | cat > series', {}, '', ['series'], 'Write an exactly representable decimal sequence through a pipe.'],
  ['seq', 'equal-width', 'seq -w 8 11 > serials', {}, '', ['serials'], 'Generate fixed-width identifiers crossing a decimal digit boundary.'],
  ['nl', 'number-blank-lines', "nl -ba -w2 -s ':' input | cat > numbered", { input: 'first\n\nlast\n' }, '', ['numbered'], 'Number all records, including an empty one, into a report.'],
  ['nl', 'custom-increment', "nl -ba -v5 -i2 -w1 -s ':' input > numbered", { input: 'one\ntwo\n' }, '', ['numbered'], 'Number two VFS records with a nondefault start and increment.'],
  ['rev', 'c-byte-binary', 'rev input | cat > reversed', { input: Buffer.from([65, 0, 255, 66, 10]) }, '', ['reversed'], 'Reverse a binary line under the documented C-byte profile.'],
  ['rev', 'multiple-operands', 'rev first second > reversed', { first: 'stressed\n', second: 'drawer\n' }, '', ['reversed'], 'Read distinct VFS operands without intermixing line order.'],
  ['unexpand', 'all-tab-stops', 'unexpand -a -t 4 input | cat > compact', { input: '    one    two\n' }, '', ['compact'], 'Compact blanks throughout lines using fixed C-byte columns.'],
  ['unexpand', 'leading-only', 'unexpand input > compact', { input: '        lead        tail\n' }, '', ['compact'], 'Default conversion must distinguish indentation from interior blanks.'],
  ['split', 'binary-segments', 'split -b 3 payload part. && cat part.aa part.ab part.ac > joined', { payload: Buffer.from([0, 255, 1, 2, 128, 3, 4]) }, '', ['part.aa', 'part.ab', 'part.ac', 'joined'], 'Create exact binary VFS segments and reconstruct through VFS reads.'],
  ['split', 'pipeline-records', 'cat input | split -l 2 - chunk. && cat chunk.aa chunk.ab > joined', { input: 'one\ntwo\nlast' }, '', ['chunk.aa', 'chunk.ab', 'joined'], 'Split a pipe with an unterminated last record and reconstruct bytes.'],
  ['date', 'explicit-epoch', "date -u -d '@1700000000' '+%F %T' | cat > stamp", {}, '', ['stamp'], 'Format a fixed instant without wall-clock or timezone-name dependence.'],
  ['date', 'leap-calendar', "date -u -d '2024-02-29 12:34:56Z' '+%Y-%m-%dT%H:%M:%S' > stamp", {}, '', ['stamp'], 'Format an explicit leap-day calendar input under UTC.'],
  ['printenv', 'named-nul', 'printenv -0 FIRST EMPTY FIRST > values', {}, '', ['values'], 'Capture named/repeated/empty exported values in requested order with NUL terminators.'],
  ['printenv', 'named-pipeline', 'printenv FIRST SECOND | cat > values', {}, '', ['values'], 'Forward explicit named values through a pipe; do not assert enumeration order.'],
  ['sleep', 'zero-marker', 'sleep 0 && cat input > marker', { input: 'after-zero\n' }, '', ['marker'], 'Successful zero sleep must permit a subsequent VFS write. No timing claim.'],
  ['sleep', 'fractional-marker', 'sleep 0.001s && cat input > marker', { input: 'after-interval\n' }, '', ['marker'], 'A short positive duration permits subsequent VFS work. No precision/speed assertion.'],
];
const family = name => ['tac', 'expand', 'fold', 'strings'].includes(name) ? 'stream-inspection' : ['seq', 'nl', 'rev', 'unexpand'].includes(name) ? 'stream-format' : name === 'split' ? 'split' : 'time-env';
const proposedProfile = {
  id: 'proposed-memory-vfs-c-byte-utc-v1', status: 'proposed-unapproved-unexecuted', cwd: '/fixture',
  environment: { HOME: '/home/user', TMPDIR: '/tmp', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', FIRST: 'alpha\nbeta', SECOND: 'second', EMPTY: '' },
  preexistingDirectories: ['/fixture', '/tmp', '/home/user'], network: 'disabled',
  filesystem: 'explicit fresh memory VFS; native future capture uses isolated corresponding fixture and external scratch role',
  runtimeBoundary: 'future public package exports only after independent inventory and different packed review; registration and actual shell dispatch reported separately',
  comparison: 'exact status, stdout/stderr bytes, final path/type/file bytes/symlink census; stable mode assertions only under a separately declared compatible metadata profile',
  limits: { inputBytesPerRecipe: 65536, outputBytesPerChannel: 1048576, fixtureEntries: 128, independentFutureDeadlineMs: 10000 },
  excluded: ['remote-provider guarantees', 'performance or scheduling precision', 'Unicode display widths', 'negative/unsupported flags', 'native oracle availability claims', 'du work'],
  nativeProfiles: [
    { id: 'gnu97-darwin-arm64-coreutils', status: 'availability-unverified-in-this-task', commands: ['tac', 'expand', 'fold', 'seq', 'nl', 'unexpand', 'split', 'date', 'printenv', 'sleep'] },
    { id: 'gnu-binutils244-darwin-strings', status: 'availability-unverified-in-this-task', commands: ['strings'] },
    { id: 'apple-darwin-rev-c-byte', status: 'availability-unverified-in-this-task', commands: ['rev'] },
    { id: 'gnu-linux-and-util-linux', status: 'separate-unavailable-profile-not-substituted', commands: [] },
  ],
};
const holdouts = holdoutSpecifications.map(([name, suffix, script, files, stdin, outputPaths, intent], index) => {
  const input = { cwd: '/fixture', files: Object.fromEntries(Object.entries({ ...files, sentinel: 'untouched\n' }).map(([path, bytes]) => [path, encode(bytes)])), stdinBase64: encode(stdin), directories: [], fileModes: {}, fileTimes: {}, symlinks: {} };
  const document = publicSnapshot.documents.find(item => item.path === `src/commands/${family(name)}/README.md`);
  assert.ok(document);
  return { id: `proposed/v1/${String(index + 1).padStart(2, '0')}/${name}/${suffix}`, name, script, input, inputCanonicalSha256: digest(input), scriptSha256: hash(script), profile: proposedProfile.id, publicDocumentation: { path: document.path, sha256: document.sha256 }, intent, plannedOutputPaths: outputPaths, mustPreserveInputs: true, nativeExpected: null, oracleStatus: 'future-independent-generation-required', candidateBinding: null, status: 'sealed-proposal-not-pass', staticCoverage: descriptor(`proposed/${name}/${suffix}`, name, script, input, proposedProfile.id, { environment: proposedProfile.environment }) };
});
assert.equal(holdouts.length, 24);
assert.ok(!holdouts.some(row => row.name === 'du'));
function overlap(left, right) {
  const fields = ['declaredTarget', 'scriptSha256', 'byteInputSha256', 'fullFixtureSha256', 'scriptAndByteInputSha256', 'fullRecipeProfileSha256'];
  const matches = Object.fromEntries(fields.map(field => {
    const pairs = left.flatMap(first => right.filter(second => first[field] === second[field]).map(second => ({ left: first.id, right: second.id, value: first[field] })));
    return [field, { pairs: pairs.length, leftCases: new Set(pairs.map(pair => pair.left)).size, rightCases: new Set(pairs.map(pair => pair.right)).size, matches: pairs }];
  }));
  const leftTokens = new Set(left.flatMap(row => row.lexicalTokens));
  const rightTokens = new Set(right.flatMap(row => row.lexicalTokens));
  const leftAssets = left.flatMap(row => row.assets.filter(asset => asset.byteLength > 0).map(asset => ({ id: row.id, ...asset })));
  const rightAssets = right.flatMap(row => row.assets.filter(asset => asset.byteLength > 0).map(asset => ({ id: row.id, ...asset })));
  const sharedBytes = [...new Set(leftAssets.filter(first => rightAssets.some(second => first.sha256 === second.sha256)).map(item => item.sha256))];
  return { leftCases: left.length, rightCases: right.length, matches, sharedLexicalTokens: [...leftTokens].filter(token => rightTokens.has(token)).sort(), sharedNonemptyPayloadSha256: sharedBytes, sharedNonemptyPayloadCases: { left: [...new Set(leftAssets.filter(item => sharedBytes.includes(item.sha256)).map(item => item.id))], right: [...new Set(rightAssets.filter(item => sharedBytes.includes(item.sha256)).map(item => item.id))] }, fullProfileEqual: [...new Set(left.map(row => row.profile))].filter(profile => right.some(row => row.profile === profile)), interpretation: 'Mechanical descriptors only. Byte-input ignores modes/times/env; fixture hash omits profile/env; lexical tokens include quoted data/arguments, not proven invocations. Distinct descriptors do not prove semantic disjointness. No cohort-union denominator.' };
}
const originalDescriptors = oldCases.map(row => row.staticCoverage);
const alignedDescriptors = oldCases.map(row => descriptor(row.id, row.recipe.command, row.recipe.script, row.input, profileIds.aligned, { network: row.recipe.network }));
const breadthDescriptors = breadthCases.map(row => row.staticCoverage);
const targetDescriptors = [...defaults, ...optional].map(row => row.staticCoverage);
const holdoutDescriptors = holdouts.map(row => row.staticCoverage);
const overlapReport = {
  originalVersusAligned: overlap(originalDescriptors, alignedDescriptors),
  old224VersusBreadth68: overlap(originalDescriptors, breadthDescriptors),
  old224VersusBreadth54Targets: overlap(originalDescriptors, targetDescriptors),
  old224VersusProposed24: overlap(originalDescriptors, holdoutDescriptors),
  breadth68VersusProposed24: overlap(breadthDescriptors, holdoutDescriptors),
};
const capturedHistoricalLinks = breadthMatrix.rows.flatMap(row => (row.originalInventoryRow.recipes ?? []).map(prior => {
  const original = oldCases.find(item => item.id === prior.id);
  const later = breadthCases.find(item => item.id === row.observation.id);
  assert.ok(original && later);
  assert.equal(original.capturedRecipeHash, prior.recipeHash);
  return { oldCaseId: prior.id, breadthCaseId: later.id, originalInventoryName: row.name, oldDeclaredLabel: original.recipe.command, exactScriptEqual: original.staticCoverage.scriptSha256 === later.staticCoverage.scriptSha256, provenance: reference(refs.faraday, `${author}/attempt-002/matrix.json`, '/rows'), interpretation: 'Captured inventory linkage, not identical recipe or inferred runtime equivalence; dot versus . is retained literally.' };
}));
assert.equal(capturedHistoricalLinks.length, 3);
overlapReport.old224VersusBreadth68.capturedHistoricalInventoryLinks = capturedHistoricalLinks;
const originalEnvironment = { PATH: '/usr/bin:/bin', HOME: '/fixture', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
const historicalSetup = {
  extraction: 'Literal manually inspected frozen harness declarations, not module evaluation; raw source hashes bind the complete setup.',
  cwd: '/fixture', directoryMode: 493, defaultFileMode: 420, defaultFileTimeMilliseconds: 1700000000000,
  nativeUmask: '022', maximumBytes: 4194304,
  oursLimits: { maxOutputBytes: 4194304, maxCommands: 10000, maxLoopIterations: 10000, pipeHighWaterMark: 4096 },
  baselineLimits: { maxOutputSize: 4194304, maxCommandCount: 10000, maxLoopIterations: 10000, maxExecutionTimeMs: 5000 },
  network: { enablement: 'Only eight explicitly network-marked recipes; {{BASE}} is the isolated loopback role.', serverDefinition: reference(refs.curie, 'benchmarks/expanded/server.mjs'), transportBoundary: 'Native bytes and virtual Uint8Array; baseline latin1 stdinKind=bytes and public stdoutAsBytes conversion; baseline stderr UTF-8 text boundary. Original raw terminal-byte defects remain.' },
};
function staticCounts(rows) {
  return { recipes: rows.length, nonemptyStdinRecipes: rows.filter(row => row.input.stdinBase64 !== '').length, fileFixtureRecipes: rows.filter(row => Object.keys(row.input.files).length > 0).length, scriptsContainingLiteralPipe: rows.filter(row => row.staticCoverage.literalPipeCharacterCount > 0).length, scriptsContainingLiteralRedirect: rows.filter(row => row.staticCoverage.literalRedirectCharacterCount > 0).length, declaredTargets: new Set(rows.map(row => row.staticCoverage.declaredTarget)).size, caveat: 'Static syntactic/input coverage, not actual invocation or passing cases; literal characters may appear inside data.' };
}
const typeCase = oldCases.find(row => row.id === 'kernel/type/type');
const profiles = {
  original: { id: profileIds.original, primaryProfile: originalNative.primaryProfile, toolIdentities: originalNative.toolIdentities, projections: originalNative.projections, sourceHashes: originalNative.sourceHashes, nativeReference: reference(refs.curie, `${expanded}/native-corrected/native.json`), harnessBinding: replayProfiles.original, scratch: 'Native TMPDIR is a nonexistent fixture child; original virtual scratch settings are retained via pinned harness artifacts. Do not pretend aligned setup was original.' },
  aligned: { id: profileIds.aligned, primaryProfile: alignedNative.primaryProfile, toolIdentities: alignedNative.toolIdentities, projections: alignedNative.projections, sourceHashes: alignedNative.sourceHashes, nativeReference: reference(refs.aligned, `${expanded}/native-scratch-aligned/native.json`), harnessBinding: replayProfiles['scratch-aligned'], scratch: 'Explicit preexisting external scratch for native, /tmp for virtual; no /fixture/tmp fabrication; fixture census remains exact.' },
  breadth: { id: profileIds.breadth, environment: breadthInput.environment, childEnvironment: breadthInput.childEnvironment, configurations: breadthInput.configurations, budgets: breadthInput.budgets, network: breadthInput.network, correctedSetup: breadthInput.correctedSetup, comparisonPolicy: breadthInput.comparisonPolicy, staleProse: 'comparisonPolicy.namespace says fixture/tmp; correctedSetup and raw census omit /fixture/tmp. Preserve both, do not execute stale prose.', sourceSha256: breadthInput.sourceSha256, dispatch: breadthInput.dispatch, oracleKind: 'predetermined-intent-not-native' },
  proposed: proposedProfile,
};
profiles.original.setup = { ...historicalSetup, virtualEnvironment: originalEnvironment, explicitVirtualDirectoriesBeforeRecipe: ['/fixture'], nativeEnvironmentOverrides: { PATH: '{{NATIVE_ROLE_BIN}}', HOME: '{{NATIVE_FIXTURE}}', TMPDIR: '{{NATIVE_FIXTURE}}/tmp' }, commonReference: reference(refs.curie, 'benchmarks/expanded/common.mjs'), engineReference: reference(refs.curie, 'benchmarks/expanded/engine.mjs'), nativeReference: reference(refs.curie, 'benchmarks/expanded/native.mjs') };
profiles.aligned.setup = { ...historicalSetup, virtualEnvironment: { ...originalEnvironment, TMPDIR: '/tmp' }, explicitVirtualDirectoriesBeforeRecipe: ['/tmp', '/fixture'], nativeEnvironmentOverrides: { PATH: '{{NATIVE_ROLE_BIN}}', HOME: '{{NATIVE_FIXTURE}}', TMPDIR: '{{PREEXISTING_NATIVE_EXTERNAL_SCRATCH}}' }, commonReference: reference(refs.aligned, 'benchmarks/expanded/common.mjs'), engineReference: reference(refs.aligned, 'benchmarks/expanded/engine.mjs'), nativeReference: reference(refs.aligned, 'benchmarks/expanded/native.mjs') };
const manifest = {
  schemaVersion: 1, scope: 'historical/static-preparation-only', designDate: '2026-08-27', refs,
  ownership: 'Only benchmarks/reports/current-comparison-20260827/cohorts/** and /tmp; no stage/commit until root review',
  candidate: { status: 'not-provided-not-approved', source: null, inventory: null, names: null, diff: null, rootOwner: 'Curie', sequence: 'independent inventory, root integration 68->70, then a different packed reviewer', closedWorker: 'Plato', note: 'User-reported transition labels are not inspected candidate evidence; never infer literal added names from arithmetic.' },
  execution: { productImports: 0, productExecutions: 0, engineImports: 0, nativeWorkloads: 0, newOracleCaptures: 0, comparisonsRun: 0, timingRuns: 0, installs: 0, harnessEvaluation: 0, privateCheckoutReads: 0, sourceOrTestInspectionForHoldoutDesign: 0, pureChecksOnly: true },
  historical224: { cases: oldCases.length, groups: countBy(originalNative.recipes, 'group'), declaredTargets: [...new Set(originalNative.recipes.map(row => row.command))].sort(), extraPerformanceRecipesExcludedFromFunctionalDenominator: originalNative.performanceRecipes.map(row => ({ id: row.id, sha256: digest(row) })), nativeCapturedObservations: originalNative.observations.length, frozenProduct: historicalReport.revision, historicalHarnessRevision: historicalReport.harnessRevision, sourceSnapshot: historicalReport.sourceSnapshot, sourceHashes: historicalReport.sourceHashes, scores: { bd2cac: { ours: score(historicalRows, 'virtual-bash'), baseline: score(historicalRows, 'just-bash') }, replayOriginal: { ours: score(originalRows, 'virtual-bash'), baseline: score(originalRows, 'just-bash') }, replayAligned: { ours: score(alignedRows, 'virtual-bash'), baseline: score(alignedRows, 'just-bash') } }, replayProvenance: { sourceHead: replaySummary.sourceHead, dirtySource: replaySummary.dirtySource, untrackedSource: replaySummary.untrackedSource, sourceManifestDigest: replaySummary.sourceManifestDigest, sourceManifestFileSha256: replaySummary.sourceManifestFileSha256, sourceFiles: replaySummary.sourceFiles, caveats: replaySummary.caveats }, rawReportReference: reference(refs.curie, `${expanded}/corrected-bd2cacb/report.json`), replayQualification: reference(refs.replay, `${replay}/capture-qualification.json`) },
  exactOriginalAlignedDelta: { all224RecipesIdentical: true, all4PerformanceRecipesIdentical: true, comparedNativeObservations: 228, oracleDeltas, observedEnginePairsCompared: 448, observedEngineByteStatusFixtureDeltas: actualProfileDeltas, historicalReplayScoreDelta: replaySummary.profileScoreDelta, warning: 'Separate native scratch-profile correction, not a product fix. Four extra performance observations are historical artifacts only; no new timing.' },
  classificationLiteral: { id: typeCase.id, script: typeCase.recipe.script, native: typeCase.originalOracle.observation, replayOriginal: typeCase.historicalResults.replayOriginal['virtual-bash'].observation, warning: 'Native builtin/file/function versus plugin command/command/function is a literal mismatch, not permission to relabel registry plugins as shell builtins. Compare exit status and exact type output separately.' },
  breadth: { historicalInventoryRows: breadthMatrix.rows.length, formerlyUnmeasuredDefaultTargets: defaults.length, optionalTargets: optional.length, originalMissingCompatibleSpellings: reviewMatrix.dispatchEvidence.length, confirmedMissingAtFrozenSource: reviewMatrix.dispatchEvidence.filter(row => row.missingConfirmed).length, primaryRecipes: breadthInput.cases.length, diagnosticRecipes: breadthInput.diagnostics.length, distinctCaseEngineOutcomes: continuation.observations.length, normalChildExits: continuation.counts.normalChildren, cleanupFailures: continuation.counts.actualAttempts - continuation.counts.normalChildren, exactTargetPositives: { ours: exactPositives([...defaults, ...optional], 'ours'), baseline: exactPositives([...defaults, ...optional], 'baseline') }, allPrimaryPositiveCounts: reviewMatrix.summary.exactPositiveAllPrimary, sourceSha256: breadthInput.sourceSha256, authorCounts: breadthMatrix.counts, reviewerCounts: continuation.counts, reviewerSummary: reviewMatrix.summary, historicalOverlapControlIds: breadthCases.filter(row => row.recipe.cohort === 'historical-measured-control').map(row => row.id), sharedControlIds: breadthCases.filter(row => row.recipe.cohort === 'shared-control').map(row => row.id), attempt001To002: preparationDeltas, attempt001Preserved: reference(refs.faraday, `${author}/attempt-001/execution-inputs.json`), warning: '136 distinct outcomes per author/reviewer are not 136 distinct recipes or native-oracle passes. 137 reviewer launches include one lost-delivery phase of unknown product result; one guest JS success fails cleanup.' },
  proposed: { recipes: holdouts.length, targetNames: [...new Set(holdouts.map(row => row.name))].sort(), status: 'sealed-design-only-no-native-expectations', binding: 'Public documented-name proposals, not the approved new-to-candidate inventory; candidate inventory/diff required before selecting any execution cohort.', sourceBlindLimit: 'No new-tool implementation or tests inspected. Public docs can expose supported boundaries and examples, so not documentation-blind, randomized, exhaustive, or independently validated expectations. Historical recipes/results already read; proposal overlap is disclosed.', nativeGeneration: 'Future different agent first freezes available native identities/profile/setup, independently captures exact bytes/status/VFS effects for these sealed inputs before candidate execution; absence/unavailability is a separate not-run state, never a pass or silent profile substitution.' },
  artifacts: 'artifact-manifest.json', cases: { historical224: 'historical-224.json', breadth: 'historical-breadth.json', proposed: 'proposed-holdouts.json', profiles: 'profiles.json', overlaps: 'overlap.json', publicDocumentation: 'public-profile-snapshot.json' },
  universalUnionDenominator: null,
};
manifest.historical224.capturedDispatchInventory = historicalReport.inventory;
manifest.historical224.baselineRelease = historicalReport.baseline;
manifest.historical224.capturedRuntime = historicalReport.runtime;
manifest.historical224.invalidNativeObservationCount = originalNative.invalidCount;
manifest.staticCoverageCounts = { historical224: staticCounts(oldCases), historicalBreadth68: staticCounts(breadthCases), proposed24: { ...staticCounts(holdouts), recipesWithPlannedVfsOutputs: holdouts.filter(row => row.plannedOutputPaths.length > 0).length, plannedOutputPaths: holdouts.reduce((sum, row) => sum + row.plannedOutputPaths.length, 0) } };
manifest.requiredRootInputs = ['Exact frozen candidate commit/tree/source/pack hashes and dirty-state qualification', 'Approved literal default/optional/kernel names and exact added/removed name diff, not count arithmetic', 'Independent candidate inventory and authenticated prerequisites/tracked consumer inventory', 'Different packed-review acceptance after root integration', 'Pinned public baseline release/dependency identity and matching explicit configuration', 'Independent oracle-owner authorization and executable/library/host/profile availability', 'Explicit byte/scratch/network/lifecycle setup and limits', 'Registry-plugin versus actual-builtin reporting decision without changing native goldens'];
const outputs = {
  'artifact-manifest.json': { schemaVersion: 1, classification: 'immutable-git-blob-byte-inventory-not-execution-proof', sets: artifactSets.map(({ artifacts: members, ...set }) => ({ ...set, count: members.length, bytes: members.reduce((sum, item) => sum + item.bytes, 0) })), artifacts },
  'historical-224.json': oldCases,
  'historical-breadth.json': breadthCases,
  'profiles.json': profiles,
  'proposed-holdouts.json': { profile: proposedProfile, cases: holdouts },
  'public-profile-snapshot.json': publicSnapshot,
  'overlap.json': overlapReport,
  'manifest.json': manifest,
};
function publish(path, bytes) {
  if (mode === '--check') {
    assert.deepEqual(readFileSync(path), Buffer.from(bytes), `Static reconstruction differs: ${relative(root, path)}`);
    return;
  }
  const patch = existsSync(path) ? `*** Delete File: ${path}\n*** Add File: ${path}\n` : `*** Add File: ${path}\n`;
  execFileSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n${patch}${bytes.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`, maxBuffer: 8 * 1024 * 1024 });
}
const seals = [];
for (const [name, value] of Object.entries(outputs)) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  publish(resolve(owned, name), bytes);
  seals.push({ path: name, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) });
}
for (const name of ['prepare.mjs', 'COHORT_PLAN.md']) {
  const bytes = readFileSync(resolve(owned, name));
  seals.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
}
publish(resolve(owned, 'SEAL.json'), `${JSON.stringify({ schemaVersion: 1, status: 'pre-candidate-design-and-historical-input-integrity-only', algorithm: 'sha256', files: seals, contentDigest: digest(seals), authorityLimit: 'Hash pinning detects changes against this seal; not a signature or root approval. Once reviewed, retain this version and create a new version for changes.' }, null, 2)}\n`);
console.log(JSON.stringify({ result: 'PASS-pure-static-checks', mode, historicalCases: oldCases.length, breadthRecipes: breadthCases.length, historicalDistinctOutcomes: continuation.observations.length, proposedRecipes: holdouts.length, artifactBindings: artifacts.length, uniqueGitBlobs: blobs.length, sealDigest: digest(seals), executions: manifest.execution, overlapSummary: Object.fromEntries(Object.entries(overlapReport).map(([name, report]) => [name, Object.fromEntries(Object.entries(report.matches).map(([key, value]) => [key, { pairs: value.pairs, leftCases: value.leftCases, rightCases: value.rightCases }]))])) }, null, 2));

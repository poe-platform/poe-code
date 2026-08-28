import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const scope = path.dirname(directory);
const output = path.join(directory, 'DATA-01');
const started = performance.now();
const maximumMs = 240000;
const maximumCapture = 1048576;
const hash = body => createHash('sha256').update(body).digest('hex');
let captured = 0;
let sequence = 0;
const results = [];
function demand(condition, label) { if (!condition) throw new Error(label); }
function clock() { demand(performance.now() - started < maximumMs, 'DATA_DEADLINE'); }
async function record(role, value) {
  clock();
  const bytes = Buffer.from(JSON.stringify({ role, ...value }) + '\n');
  demand(captured + bytes.length <= maximumCapture, 'DATA_CAPTURE_LIMIT');
  captured += bytes.length;
  await fs.writeFile(path.join(output, String(++sequence).padStart(3, '0') + '.json'), bytes, { flag: 'wx', mode: 0o600 });
}
async function input(filename, expected) {
  clock();
  const stat = await fs.lstat(filename);
  demand(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o644 && stat.size <= 1048576, 'DATA_REGULAR_INPUT');
  const bytes = await fs.readFile(filename);
  demand(bytes.length === expected.bytes && hash(bytes) === expected.sha256, 'DATA_INPUT_IDENTITY:' + filename);
  return bytes;
}
function errorData(error) {
  const descriptor = error !== null && (typeof error === 'object' || typeof error === 'function') ? Object.getOwnPropertyDescriptor(error, 'message') : null;
  return { type: error === null ? 'null' : typeof error, message: typeof descriptor?.value === 'string' ? descriptor.value.slice(0, 2048) : null };
}
async function outcome(id, role, action, predicate) {
  clock();
  let value;
  let failure;
  try { value = action(); } catch (error) { failure = errorData(error); }
  await record(role, { id, value: value ?? null, error: failure ?? null });
  const passed = predicate(value, failure);
  results.push({ id, role, passed });
  await record('DATA_ASSERTION', { id, passed });
}
function canonicalBase64(value) {
  demand(typeof value === 'string' && value.length % 4 === 0, 'DECLARED_BASE64_LENGTH');
  const bytes = Buffer.from(value, 'base64');
  demand(bytes.toString('base64') === value, 'DECLARED_BASE64_CANONICAL');
  return bytes;
}
function keys(value, allowed, label) {
  demand(value !== null && typeof value === 'object' && !Array.isArray(value), label);
  demand(Object.keys(value).every(key => allowed.includes(key)), label + '_FIELDS');
}
function bodyDeclaration(body) {
  if (body === undefined) return;
  keys(body, ['text', 'hex', 'base64', 'repeat'], 'BODY');
  const fields = Object.keys(body);
  demand(fields.length <= 1, 'BODY_EXCLUSIVE_ENCODING');
  if (fields.length === 0) return;
  const field = fields[0];
  if (field === 'text') demand(typeof body.text === 'string' && body.text.isWellFormed(), 'BODY_UTF8');
  if (field === 'hex') demand(typeof body.hex === 'string' && /^(?:[a-f0-9]{2})*$/.test(body.hex), 'BODY_HEX');
  if (field === 'base64') canonicalBase64(body.base64);
  if (field === 'repeat') { keys(body.repeat, ['byte', 'count'], 'BODY_REPEAT'); demand(Number.isInteger(body.repeat.byte) && body.repeat.byte >= 0 && body.repeat.byte <= 255 && Number.isInteger(body.repeat.count) && body.repeat.count >= 0 && body.repeat.count <= 131072, 'BODY_REPEAT_VALUE'); }
}
function declaration(spec, data) {
  keys(spec, ['args', 'shell', 'packs', 'removeLoose', 'omit', 'extra', 'actor'], 'SPEC');
  if (spec.args !== undefined) demand(Array.isArray(spec.args) && spec.args.length <= 32 && spec.args.every(value => typeof value === 'string'), 'ARGV');
  for (const pack of spec.packs ?? []) {
    keys(pack, ['frozen', 'build'], 'PACK');
    demand(Object.keys(pack).length === 1, 'PACK_ROLE');
    if (pack.frozen !== undefined) { demand(data.packs.some(row => row.id === pack.frozen), 'FROZEN_ID'); continue; }
    const build = pack.build;
    keys(build, ['badPackChecksum', 'crcRecordMutation', 'emptyLargeSlot', 'emptyTrailing', 'entries', 'headerCount', 'indexMutation', 'indirect', 'signature', 'truncatePackBytes', 'version'], 'BUILD');
    demand(Array.isArray(build.entries) && build.entries.length <= 64, 'BUILD_ENTRIES');
    for (const entry of build.entries) {
      keys(entry, ['base', 'body', 'compressedHex', 'copyBase', 'declared', 'dictionaryHex', 'indexOid', 'level', 'literalResult', 'logicalType', 'prefixHex', 'programHex', 'requireCompressedBytes', 'secondMember', 'storage', 'storageType', 'suffixHex', 'truncateZlib'], 'ENTRY');
      bodyDeclaration(entry.body);
      for (const field of ['compressedHex', 'dictionaryHex', 'prefixHex', 'programHex', 'suffixHex']) if (entry[field] !== undefined) demand(typeof entry[field] === 'string' && /^(?:[a-f0-9]{2})*$/.test(entry[field]), 'ENTRY_HEX');
    }
  }
  for (const extra of spec.extra ?? []) { keys(extra, ['path', 'body', 'type'], 'EXTRA'); bodyDeclaration(extra.body); }
}
await fs.mkdir(output, { mode: 0o700 });
let unsafe = null;
let counts;
try {
  const inputBytes = await fs.readFile(path.join(directory, 'INPUTS.json'));
  const expectedBytes = await fs.readFile(path.join(directory, 'EXPECTED-BYTES.json'));
  demand(hash(inputBytes) === '0d49b37705c19d69fc18e2073b7009d6181c7d4a0624db61bfb8089fc529f298', 'INPUT_SEAL');
  demand(hash(expectedBytes) === '88cbf731530f47fb7bf756cb831c7000ca5571a231a784089b162ce7a7be98b6', 'EXPECTED_SEAL');
  const inputs = JSON.parse(inputBytes);
  const expected = JSON.parse(expectedBytes);
  demand(process.execPath === inputs.node.path && process.execArgv.length === 0 && !process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'DATA_EXACT_NODE');
  const nodeHash = createHash('sha256');
  for await (const bytes of createReadStream(process.execPath)) { clock(); nodeHash.update(bytes); }
  demand(nodeHash.digest('hex') === inputs.node.sha256, 'NODE_HASH');
  const bodies = new Map();
  for (const row of inputs.files) bodies.set(row.path, await input(path.join(scope, row.path), row));
  const originalBytes = await fs.readFile(path.join(directory, 'NEUTRAL-ORIGINAL.json.data'));
  demand(hash(originalBytes) === expected.original.sha256, 'ORIGINAL_STORED_NEUTRAL');
  const original = JSON.parse(originalBytes);
  const data = JSON.parse(bodies.get('semantic/FROZEN-DATA.json'));
  const table = JSON.parse(bodies.get('semantic/CASE-DATA.json'));
  demand(JSON.stringify(original.files) === JSON.stringify(data.neutral.files), 'UNCHANGED_EXPLICIT_ROWS');
  const { decodeNeutralFile, createFixture } = await import(pathToFileURL(path.join(directory, 'fixtures.mjs')).href);
  const positives = [['ascii', 'text', 'hello\n', '68656c6c6f0a'], ['UTF8', 'text', 'é😀', 'c3a9f09f9880'], ['empty-text', 'text', '', ''], ['CRLF', 'text', 'a\r\nb\r\n', '610d0a620d0a'], ['binary', 'base64', 'AP+A', '00ff80'], ['empty-binary', 'base64', '', ''], ['one-padding', 'base64', 'YWI=', '6162'], ['two-padding', 'base64', 'YQ==', '61'], ['text-not-sniffed', 'text', 'YQ==', '59513d3d'], ['NUL', 'text', '\u0000', '00'], ['BOM', 'text', '\ufeffx', 'efbbbf78']];
  for (const [id, role, value, hex] of positives) await outcome('positive-' + id, 'DECODER_CONTROL', () => ({ hex: decodeNeutralFile({ path: 'file', mode: 420, [role]: value }).toString('hex') }), (value, error) => !error && value.hex === hex);
  let accessorReads = 0;
  const accessor = { path: 'file', mode: 420 };
  Object.defineProperty(accessor, 'text', { enumerable: true, get() { accessorReads++; throw new Error('GETTER_MUST_NOT_RUN'); } });
  const negatives = [['missing', { path: 'file', mode: 420 }], ['ambiguous', { path: 'file', mode: 420, text: 'a', base64: 'YQ==' }], ['nonstring', { path: 'file', mode: 420, text: null }], ['unpaired-surrogate', { path: 'file', mode: 420, text: '\ud800' }], ['accessor', accessor], ['inherited', Object.assign(Object.create({ text: 'a' }), { path: 'file', mode: 420 })], ['extra', { path: 'file', mode: 420, text: 'a', ignored: true }], ['order', { mode: 420, path: 'file', text: 'a' }], ['path', { path: '../file', mode: 420, text: 'a' }], ['mode', { path: 'file', mode: 1.5, text: 'a' }], ['text-bound', { path: 'file', mode: 420, text: 'a'.repeat(131073) }], ...['YQ', 'YQ=', 'YQ===', 'Y?==', 'YQ==\n', 'YR==', ' YQ==', '-w=='].map((base64, index) => ['base64-' + index, { path: 'file', mode: 420, base64 }])];
  for (const [id, row] of negatives) await outcome('negative-' + id, 'DECODER_CONTROL', () => ({ hex: decodeNeutralFile(row).toString('hex') }), (value, error) => Boolean(error) && accessorReads === 0);
  function pinned(row, wanted) { const bytes = decodeNeutralFile(row); demand(bytes.length === wanted.bytes && bytes.toString('hex') === wanted.hex && hash(bytes) === wanted.sha256, 'NEUTRAL_BYTE_BINDING'); return { path: row.path, role: wanted.role, bytes: bytes.length, sha256: hash(bytes) }; }
  for (const row of data.neutral.files) await outcome('neutral-' + row.path, 'ORIGINAL_BYTE_BINDING', () => pinned(row, expected.files.find(item => item.path === row.path)), (value, error) => !error);
  for (const role of ['text', 'base64']) {
    const row = data.neutral.files.find(item => Object.hasOwn(item, role));
    const mutated = { ...row, [role]: role === 'text' ? row.text + 'x' : Buffer.from([0]).toString('base64') };
    await outcome('mutation-' + role, 'BINDING_NEGATIVE_CONTROL', () => pinned(mutated, expected.files.find(item => item.path === row.path)), (value, error) => Boolean(error));
  }
  for (const pair of data.packs) for (const role of ['pack', 'index']) await outcome(pair.id + '-' + role, 'FROZEN_PACK_DATA_BINDING', () => { const bytes = canonicalBase64(pair[role + 'Base64']); demand(bytes.length === pair[role + 'Bytes'] && hash(bytes) === pair[role + 'Sha256'], 'FROZEN_PACK_BYTES'); return { bytes: bytes.length, sha256: hash(bytes) }; }, (value, error) => !error);
  let variants = 0;
  for (const row of table.cases) for (const [role, spec] of [['control', row.control], ['variant', row.spec]]) {
    if (spec === undefined) continue;
    variants++;
    await outcome(row.id + ':' + role, 'FIXTURE_DECLARATION_AND_CONSTRUCTION_DATA', () => {
      declaration(spec, data);
      const fixture = createFixture(data, spec);
      return { args: fixture.args, files: fixture.files.map(file => ({ path: file.path, mode: file.mode, type: file.type, bytes: file.bytes.length, sha256: hash(file.bytes) })), facts: fixture.facts };
    }, (value, error) => !error);
  }
  const witnesses = JSON.parse(bodies.get('semantic-integration-v2/WITNESSES.json'));
  for (const witness of witnesses.entries) await outcome(witness.id, 'LOADED_WITNESS_DECLARATION_DATA', () => { const row = table.cases.find(item => item.id === witness.fixtureId); demand(hash(Buffer.from(JSON.stringify(row))) === witness.fixtureDescriptorSha256 && JSON.stringify(row.expected) === JSON.stringify(witness.stockExpected), 'UNCHANGED_WITNESS'); return { fixtureId: row.id, transform: witness.transform.emittedPostimage.sha256 }; }, (value, error) => !error);
  const types = JSON.parse(bodies.get('mechanical-type-api-v2/FIXTURES.json'));
  for (const fixture of types.fixtures) await outcome(fixture.id, 'TYPE_FIXTURE_DATA_NOT_COMPILER', () => { const bytes = canonicalBase64(fixture.base64); demand(bytes.length === fixture.bytes && hash(bytes) === fixture.sha256, 'TYPE_TEMPLATE'); return { bytes: bytes.length, sha256: hash(bytes) }; }, (value, error) => !error);
  const mechanical = await import(pathToFileURL(path.join(scope, 'mechanical/fixture-data.mjs')).href);
  await outcome('private-index-fixture', 'MECHANICAL_DATA_NOT_PRODUCT', () => { const values = mechanical.indexFixture(); return Object.fromEntries(Object.entries(values).map(([key, bytes]) => [key, { bytes: bytes.length, sha256: hash(bytes) }])); }, (value, error) => !error);
  const recipe = JSON.parse(bodies.get('RECIPE-v2.json'));
  const manifests = recipe.caseManifests.map(row => JSON.parse(bodies.get(row.path)));
  const declaredCases = manifests.flatMap(manifest => manifest.cases);
  demand(declaredCases.length === 140 && declaredCases.reduce((sum, row) => sum + row.layouts.length, 0) === 274, 'UNCHANGED_COHORT');
  demand(table.cases.length === 104 && variants === 160, 'COMPLETE_VARIANTS');
  await record('COMPLETE_DECLARATION_MEMBERSHIP_NOT_PASSES', { cases: declaredCases.map(row => ({ id: row.id, role: row.role, layouts: row.layouts, requires: row.requires })), calls: 274, S01: declaredCases.filter(row => row.id.startsWith('S01')).reduce((sum, row) => sum + row.layouts.length, 0), qualification: 'All declarations bound; no actor, compiler, target, mutant or codec execution.' });
  for (const row of inputs.files) await input(path.join(scope, row.path), row);
  counts = { neutralRows: 18, textRows: 6, binaryRows: 12, decoderControls: positives.length + negatives.length, mutationControls: 2, frozenPackBindings: 26, constructedDeclarations: variants, loadedDeclarations: 3, typeData: 5, mechanicalData: 1, cohortIds: 140, cohortCalls: 274 };
} catch (error) { unsafe = errorData(error); process.exitCode = 1; }
const status = unsafe || results.some(row => !row.passed) ? 'FAIL_DATA_NO_ACTUAL_GO' : 'PASS_DATA_ONLY';
if (status !== 'PASS_DATA_ONLY') process.exitCode = 1;
await record('FINAL_DATA_RESULT', { status, unsafe, counts: counts ?? null, results, elapsedMs: performance.now() - started, captureBytesBeforeFinal: captured, childStarts: 0, targetImports: 0, compilerRuns: 0, nativeGitRuns: 0, noRetry: true });

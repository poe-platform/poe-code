import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { hash, inventory, toolInventory, read, save } from './common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), name = process.argv[2] ?? 'run05', capture = join(own, name), repo = resolve(own, '../../../..');
if (existsSync(join(own, 'ARTIFACTS.json'))) {
  const artifacts = read(join(own, 'ARTIFACTS.json'));
  for (const [path, digest] of Object.entries(artifacts.files)) assert.equal(hash(readFileSync(join(own, path))), digest, path);
  assert.deepEqual(readdirSync(own, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name).sort(), [...Object.keys(artifacts.files), 'ARTIFACTS.json'].sort());
}
const manifest = read(join(own, name + '.MANIFEST.json'));
const compressed = Buffer.from(readFileSync(join(own, name + '.json.gz.base64'), 'utf8'), 'base64');
assert.equal(hash(compressed), manifest.compressedSHA256);
const files = JSON.parse(gunzipSync(compressed));
assert.deepEqual(Object.keys(files).sort(), Object.keys(manifest.files).sort());
const bytes = path => Buffer.from(files[path], 'base64'), json = path => JSON.parse(bytes(path));
for (const [path, digest] of Object.entries(manifest.files)) assert.equal(hash(bytes(path)), digest, path);
const state = json('state.json');
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
for (const [path, entry] of Object.entries(state.inputs)) {
  assert.equal(hash(git('show', path)), entry.sha256, path);
  assert.equal(git('rev-parse', path).toString().trim(), entry.blob);
}
for (const [path, digest] of Object.entries(state.sourceBefore)) assert.equal(hash(bytes('authenticated-source/' + path)), digest, path);
for (const [path, digest] of Object.entries(state.scriptsBefore)) assert.equal(hash(readFileSync(join(own, path))), digest, path);
for (const filename of ['EXPECTATION-v2.json', 'FREEZE.md']) assert.equal(hash(git('show', state.freeze + ':tests/commands/html-to-markdown-independent-20260827/fix-review-3ef5811f/' + filename)), state.scriptsBefore[filename]);
const author = json('author/RAW_REPORT.json');
for (const [path, digest] of Object.entries(author.sourceInputsBefore)) assert.equal(state.sourceBefore[path], digest);
for (const [path, digest] of Object.entries(author.emittedBefore).filter(([path]) => !path.endsWith('.map'))) assert.equal(state.emittedBefore[path], digest);
assert.deepEqual(author.sourceInputsBefore, author.sourceInputsAfter);
assert.deepEqual(author.sourceBefore, author.sourceAfter);
assert.deepEqual(author.emittedBefore, author.emittedAfter);
assert.equal(author.rows.length, 55);
assert.match(bytes('author/canonical.tap.data').toString(), /# tests 154\n# suites 0\n# pass 154\n# fail 0/);
const tarball = bytes(state.pack[0].filename); assert.equal(hash(tarball), state.packSHA256);
const tar = gunzipSync(tarball), packed = {};
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512); if (header.every(value => value === 0)) break;
  const text = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/su, '');
  const path = (text(345, 500) ? text(345, 500) + '/' : '') + text(0, 100), type = text(156, 157), size = Number.parseInt(text(124, 136).trim(), 8) || 0;
  assert(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
  if (type === '' || type === '0') { assert(path.startsWith('package/')); packed[path.slice(8)] = hash(tar.subarray(offset + 512, offset + 512 + size)); }
  else assert(['5', 'x'].includes(type));
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.deepEqual(packed, state.installedBefore, 'tarball equals regular-file moved package inventory');
let productLoads = 0, harnessLoads = 0; const receipts = [];
function checkProductLoad(load) {
  const path = fileURLToPath(load.url), root = path.startsWith(state.installed + '/') ? state.installed : state.isolated;
  assert(path.startsWith(root + '/dist/'));
  assert.equal(load.sha256, (root === state.installed ? state.installedBefore : state.isolatedBefore)[path.slice(root.length + 1)]);
}
for (const path of Object.keys(files).filter(path => path.endsWith('.receipt.json'))) {
  const receipt = json(path), prefix = path.slice(0, -'.receipt.json'.length), pre = json(prefix + '.pre.json');
  assert.equal(hash(bytes(prefix + '.pre.json')), receipt.preSHA256);
  assert.equal(hash(bytes(prefix + '.stdout')), receipt.stdoutSHA256);
  assert.equal(hash(bytes(prefix + '.stderr')), receipt.stderrSHA256);
  assert(receipt.processGroupGone, path);
  assert.equal(pre.supervisorSHA256, state.scriptsBefore['common.mjs']);
  assert.equal(pre.executableSHA256, pre.executable === state.pandoc ? state.toolchain.pandoc.sha256 : state.toolchain.node.sha256);
  for (const load of receipt.loads) {
    if (load.url.includes('/dist/')) { checkProductLoad(load); productLoads++; }
    else { assert.equal(load.sha256, (pre.inputs.harness ?? pre.inputs)[basename(fileURLToPath(load.url))]); harnessLoads++; }
  }
  receipts.push({ path, ...receipt });
}
const someLoad = receipts.flatMap(row => row.loads).find(load => load.url.includes('/dist/'));
assert(someLoad);
assert.throws(() => checkProductLoad({ ...someLoad, sha256: '0'.repeat(64) }), { code: 'ERR_ASSERTION' });
const tamperedPack = { ...packed }; delete tamperedPack['dist/commands/html-to-markdown/index.js'];
assert.throws(() => assert.deepEqual(tamperedPack, state.installedBefore), { code: 'ERR_ASSERTION' });
if (existsSync(state.installed)) {
  assert.deepEqual(inventory(state.installed), state.installedBefore);
  assert.deepEqual(inventory(state.isolated), state.isolatedBefore);
  assert.deepEqual(inventory(join(state.isolated, 'src')), Object.fromEntries(Object.entries(state.sourceBefore).filter(([path]) => path.startsWith('src/')).map(([path, digest]) => [path.slice(4), digest])));
  for (const tool of ['typescript', '@types/node', 'undici-types']) assert.deepEqual(inventory(join(state.tools, 'node_modules', tool)), state.toolchain[tool].files);
  assert.deepEqual(toolInventory(state.npmRoot), state.toolchain.npm.files);
}
const phases = {};
for (const row of receipts) {
  const parts = row.path.split('/'); const phase = parts[0] === 'replay' ? parts.slice(0, 3).join('/') : parts.slice(0, -1).join('/');
  const entry = phases[phase] ??= { receipts: 0, natural: 0, killed: 0, assertionPass: 0, assertionFail: 0 };
  entry.receipts++; if (row.killed) entry.killed++; else entry.natural++;
  if (row.outcome === 'PASS') entry.assertionPass++; else if (row.outcome === 'FAIL') entry.assertionFail++;
}
const result = { source: state.source, verification: state.verification, authorEvidence: state.evidence, freeze: state.freeze, packSHA256: state.packSHA256, compressedSHA256: hash(compressed), archivedFiles: Object.keys(files).length, gitInputBindings: Object.keys(state.inputs).length, sourceFiles: state.productSourceFiles, emittedFiles: Object.keys(state.emittedBefore).length, packedFiles: Object.keys(packed).length, receipts: receipts.length, productLoads, harnessLoads, killed: receipts.filter(row => row.killed).map(row => ({ path: row.path, classification: row.outcome })), allGroupsGoneAtReceipt: receipts.every(row => row.processGroupGone), phases, negatives: { wrongRuntimeHashRejected: true, missingPackedEntryRejected: true }, oldASTv2: json('legacy-ast-v2/RESULTS.json').results, semanticFailures: json('followup/RESULTS.json').ast.filter(row => row.outcome === 'FAIL'), authorAttestation: { retainedOnlyNotRerun: true, tests: 154, probes: 55, parserCases: 22, matchingSourceInputs: Object.keys(author.sourceInputsBefore).length, matchingExecutableAndDeclarationOutputs: Object.keys(author.emittedBefore).filter(path => !path.endsWith('.map')).length, differentLocationDependentSourceMaps: Object.keys(author.emittedBefore).filter(path => path.endsWith('.map') && state.emittedBefore[path] !== author.emittedBefore[path]).length } };
if (process.argv.includes('--save')) { const path = join(own, 'VERIFIED.json'); assert(!existsSync(path)); save(path, result); }
console.log(JSON.stringify({ receipts: result.receipts, productLoads, harnessLoads, archivedFiles: result.archivedFiles, packSHA256: state.packSHA256, sourceBugCounterexamples: result.semanticFailures.length, verified: true }));

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
assert.equal(process.argv[2], '--capture', 'Explicit one-time evidence capture required');
const own = dirname(fileURLToPath(import.meta.url)), repo = join(own, '../../../..');
const state = JSON.parse(readFileSync(JSON.parse(readFileSync('/tmp/owned-output-independent-current.json')).state));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, args) => execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', root, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 32 * 1024 * 1024 });
const query = args => git(repo, args).toString();
function inventory(root, metadata = false, ignored = new Set()) {
  const files = {}, directories = [];
  function walk(directory) { for (const name of readdirSync(directory).sort()) {
    if (ignored.has(name)) continue;
    const path = join(directory, name), stat = lstatSync(path); assert(!stat.isSymbolicLink(), path);
    if (stat.isDirectory()) { directories.push(relative(root, path)); walk(path); }
    else { assert(stat.isFile(), path); files[relative(root, path)] = metadata ? { bytes: stat.size, sha256: hash(readFileSync(path)), mode: stat.mode, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs } : hash(readFileSync(path)); }
  } }
  walk(root); return { files, directories };
}
const source = Object.fromEntries(Object.entries(state.inputs).map(([path, expected]) => {
  const bytes = readFileSync(join(state.product, path)); assert.equal(hash(bytes), expected);
  assert.equal(hash(git(repo, ['show', state.candidate + ':' + path])), expected); return [path, expected];
}));
for (const prefix of ['src/', 'scripts/']) assert.deepEqual(inventory(join(state.product, prefix)).files, Object.fromEntries(Object.entries(source).filter(([path]) => path.startsWith(prefix)).map(([path, digest]) => [path.slice(prefix.length), digest])));
const installed = inventory(join(state.consumer, 'node_modules/virtual-bash')); assert.deepEqual(installed.files, state.installed);
const expectedDirectories = new Set(Object.keys(state.installed).flatMap(path => { const parts = path.split('/'); return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/')); }));
assert.deepEqual([...installed.directories].sort(), [...expectedDirectories].sort());
assert.equal(hash(readFileSync(state.tarball)), state.packageSHA256);
const frozen = hash(git(repo, ['show', '07bb6a79ef46bb121d02261bdc5f9072b7491049:tests/integration/owned-output-production-independent-20260827/CASES.json'])); assert.equal(state.frozenCasesSHA256, frozen);
const sourcePaths = query(['diff-tree', '--no-commit-id', '--name-only', '-r', state.candidate, '--', 'src']).trim().split('\n'); assert.equal(sourcePaths.length, 9);
const interveningPaths = query(['diff', '--name-only', state.baseline, state.candidate, '--', 'src']).trim().split('\n').filter(path => !sourcePaths.includes(path));
assert.deepEqual(interveningPaths, ['src/commands/expr/README.md', 'src/commands/expr/evaluate.ts', 'src/commands/expr/index.ts', 'src/commands/expr/internal.ts']);
assert.equal(query(['diff', '--name-only', state.baseline, state.candidate + '^', '--', ...sourcePaths]).trim(), '', 'Owned parent blobs must equal baseline');
assert.equal(hash(git(repo, ['diff', '--binary', '--no-ext-diff', state.baseline, state.candidate, '--', ...sourcePaths])), state.patchSHA256);
const streamsBefore = query(['show', state.baseline + ':src/commands/streams.ts']), streamsAfter = query(['show', state.candidate + ':src/commands/streams.ts']);
const cat = '    define("cat",', suffix = '    headTail("head"), headTail("tail"),';
assert.equal(streamsAfter.split('import { createOutputOperation, ').length, 2);
assert(streamsBefore.includes(cat) && streamsAfter.includes(cat) && streamsBefore.includes(suffix) && streamsAfter.includes(suffix));
assert.equal(streamsBefore.slice(0, streamsBefore.indexOf(cat)), streamsAfter.slice(0, streamsAfter.indexOf(cat)).replace('import { createOutputOperation, ', 'import { '));
assert.equal(streamsBefore.slice(streamsBefore.indexOf(suffix)), streamsAfter.slice(streamsAfter.indexOf(suffix)));
const privateRoot = '/Users/kjopek/Workspace/poe-code';
const safejs = JSON.parse(readFileSync(join(state.work, 'safejs-6Mzt26/REPORT.json'))), original = safejs.privateBefore;
const privateQuery = args => git(privateRoot, args).toString();
const privateAfter = {
  head: privateQuery(['rev-parse', 'HEAD']).trim(), status: privateQuery(['status', '--porcelain=v1']), staged: privateQuery(['diff', '--cached', '--name-status']),
  indexSHA256: hash(readFileSync(join(privateRoot, privateQuery(['rev-parse', '--git-path', 'index']).trim()))),
  engine: inventory(join(privateRoot, 'packages/safejs'), true, new Set(['.git', 'node_modules', 'dist', '.cache', '.turbo'])).files,
  metadata: Object.fromEntries(Object.keys(original.metadata).map(path => [path, hash(readFileSync(join(privateRoot, path)))])),
};
assert.deepEqual(privateAfter, original, 'Private checkout must remain untouched through negative controls');
const processes = execFileSync('/bin/ps', ['-axo', 'pid,ppid,command'], { encoding: 'utf8' }).split('\n').filter(line => line.includes(state.work)); assert.deepEqual(processes, [], 'Owned child processes remain');
const paths = new Set(['STATE.json', 'build.stdout', 'build.stderr', 'pack.stdout', 'pack.stderr']);
function addFiles(directory, accept = () => true) {
  if (!existsSync(join(state.work, directory))) return;
  for (const name of readdirSync(join(state.work, directory))) { const path = join(directory, name); if (lstatSync(join(state.work, path)).isFile() && accept(name)) paths.add(path); }
}
for (const directory of readdirSync(state.work)) {
  if (directory.startsWith('execution-') || directory.startsWith('legacy-review-')) addFiles(directory);
  if (directory.startsWith('public-controls')) addFiles(directory, name => /\.(?:json|stdout|stderr|mts|mjs)$/u.test(name));
  if (directory.startsWith('binding-controls-')) {
    addFiles(directory);
    for (const name of readdirSync(join(state.work, directory))) if (lstatSync(join(state.work, directory, name)).isDirectory()) {
      addFiles(join(directory, name), file => ['stdout', 'stderr', 'entry.mjs', 'imports.jsonl'].includes(file));
      addFiles(join(directory, name, 'logs'), file => file.startsWith('guard.'));
    }
  }
}
addFiles('mutants');
for (const name of readdirSync(join(state.work, 'mutants'))) if (lstatSync(join(state.work, 'mutants', name)).isDirectory()) addFiles(join('mutants', name), file => /^(?:baseline|mutated)\.(?:stdout|stderr|trace)$/u.test(file));
addFiles('safejs-6Mzt26');
for (const family of ['surface', 'lifecycle', 'controls']) { addFiles('safejs-6Mzt26/' + family, name => name === 'BINDING.json'); addFiles('safejs-6Mzt26/' + family + '/logs'); }
const files = Object.fromEntries([...paths].sort().map(path => [path, readFileSync(join(state.work, path)).toString('base64')]));
const harness = Object.fromEntries(readdirSync(own).filter(name => name.endsWith('.mjs')).sort().map(name => {
  const path = relative(repo, join(own, name)), bytes = readFileSync(join(own, name)); assert.equal(hash(git(repo, ['show', 'HEAD:' + path])), hash(bytes), 'Harness must be committed before capture'); return [path, hash(bytes)];
}));
const readReport = name => JSON.parse(readFileSync(join(state.work, name, 'REPORT.json')));
const cases = readReport('execution-1787862355851'), legacy = readReport('legacy-review-OC4Qwj'), publicTypes = readReport('public-controls-3zvqx9'), binding = readReport('binding-controls-TkHgfc'), mutants = readReport('mutants');
assert.equal(cases.rows.length, 36); assert(cases.rows.every(row => row.exitCode === 0));
assert.equal(safejs.rows.length, 25); assert(safejs.rows.every(row => row.assessment.outcome === 'PASS'));
assert.equal(legacy.rows[0].counts.pass, 505); assert.equal(legacy.rows[0].counts.fail, 0);
assert.equal(publicTypes.rows.length, 10); assert.equal(binding.rows.length, 11); assert.equal(mutants.rows.length, 7);
const loaded = new Map();
for (const path of paths) if (path.startsWith('execution-1787862355851/') && path.endsWith('.trace')) for (const line of readFileSync(join(state.work, path), 'utf8').trim().split('\n')) {
  const entry = JSON.parse(line), prefix = state.consumer + '/node_modules/virtual-bash/';
  if (entry.path.startsWith(prefix)) { const relative = entry.path.slice(prefix.length); assert.equal(state.installed[relative], entry.sha256); loaded.set(relative, entry.sha256); }
}
const summary = {
  capturedAt: new Date().toISOString(), status: 'SCOPED_ACCEPTANCE_NOT_PROMOTION', candidate: state.candidate, tree: state.candidateTree,
  baseline: state.baseline, patchSHA256: state.patchSHA256, packageSHA256: state.packageSHA256, packageJsonSHA256: state.packageJsonSHA256,
  sourcePaths, interveningPathsNotApprovedByThisReview: interveningPaths, archivedInputs: Object.keys(source).length, installedFiles: Object.keys(state.installed).length,
  authenticatedLoadedPackageModules: Object.fromEntries(loaded), frozenCasesSHA256: frozen,
  harnessCommit: query(['log', '-1', '--format=%H', '--', relative(repo, own)]).trim(), harness,
  observations: { unchangedHoldouts: { pass: 36, fail: 0, skip: 0 }, publicTypes: { positive: 1, negative: 8, identity: 1 }, bindingControls: 11, mutantsDetected: 7, actualSafeJsProfiles: { pass: 25, fail: 0, skipped: 0, surfaceDialectRejections: 2 }, legacy: legacy.rows[0].counts, originalFirstRead: legacy.rows[1].counts },
  privateUnchanged: true, privateAfter, processMatches: processes, archiveInputsUnchanged: true, installedPackageUnchanged: true,
};
const payload = Buffer.from(JSON.stringify({ summary, files })); const compressed = gzipSync(payload, { level: 9 });
const manifest = { payloadSHA256: hash(payload), gzipSHA256: hash(compressed), bytes: payload.length, gzipBytes: compressed.length, files: Object.fromEntries(Object.entries(files).map(([name, encoded]) => [name, hash(Buffer.from(encoded, 'base64'))])), harness };
for (const [name, text] of [['EVIDENCE.json.gz.base64', compressed.toString('base64') + '\n'], ['MANIFEST.json', JSON.stringify(manifest, null, 2) + '\n'], ['CHECKPOINT.json', JSON.stringify(summary, null, 2) + '\n']]) {
  const path = join(own, name); assert(!existsSync(path), 'Never overwrite prior evidence');
  execFileSync('apply_patch', [], { input: '*** Begin Patch\n*** Add File: ' + path + '\n' + text.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n', maxBuffer: 8 * 1024 * 1024 });
}
console.log(JSON.stringify({ ...summary.observations, files: paths.size, evidenceBytes: payload.length, compressedBytes: compressed.length, candidate: state.candidate }));

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, copyFileSync, renameSync, writeFileSync, existsSync, globSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../../..');
const parent = dirname(owned);
const author = join(parent, 'abort-count-v2');
const candidate = 'b282159921ce530e932b02f90c64eca987de2704';
const authorCommit = process.argv[2];
assert.match(authorCommit ?? '', /^[a-f0-9]{40}$/);
assert.ok(existsSync('/tmp/byte-abort-v2-reviewer-frozen.txt'));
assert.ok(existsSync('/tmp/byte-abort-v2-author-frozen.txt'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = path => hash(readFileSync(path));
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
const snapshot = directory => Object.fromEntries(walk(directory).sort().map(path => [relative(directory, path), digest(path)]));
const run = (binary, args, options = {}) => {
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000, killSignal: 'SIGKILL', ...options });
  return { command: [binary, ...args], status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
};
const add = (path, value) => {
  assert.ok(!existsSync(path), `append-only evidence: ${path}`);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const result = run('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${relative(root, path)}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n` });
  assert.equal(result.status, 0, result.stderr);
};
const names = ['public.mjs', 'fixtures.mjs', 'vectors.mjs', 'archives.json'];
const historicalBefore = Object.fromEntries(names.map(name => [name, digest(join(parent, name))]));
const fixtureBefore = Object.fromEntries(['EXPECTATION.md', 'controls.mjs', 'loader.mjs', 'run.mjs'].map(name => [name, digest(join(owned, name))]));
const authorBefore = Object.fromEntries(names.map(name => [name, digest(join(author, name))]));
for (const name of names) {
  const committed = run('git', ['show', `${authorCommit}:${relative(root, join(author, name))}`], { encoding: null });
  assert.equal(committed.status, 0);
  assert.equal(hash(committed.stdout), authorBefore[name]);
}
for (const name of names.slice(1)) assert.equal(authorBefore[name], historicalBefore[name], `unchanged input/helper ${name}`);
const oldPublic = readFileSync(join(parent, 'public.mjs'), 'utf8');
const newPublic = readFileSync(join(author, 'public.mjs'), 'utf8');
const start = oldPublic.indexOf("test('jq cooperative source abort");
const end = oldPublic.indexOf("test('curl response error", start);
const newEnd = newPublic.indexOf("test('curl response error", start);
assert.equal(newPublic.slice(0, start), oldPublic.slice(0, start));
assert.equal(newPublic.slice(newEnd), oldPublic.slice(end));
const delta = run('git', ['diff', '--no-index', join(parent, 'public.mjs'), join(author, 'public.mjs')]);
assert.equal(delta.status, 1);
add(join(owned, 'evidence', 'reviewed-delta.patch'), delta.stdout);
const liveBefore = snapshot(join(root, 'src'));
const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
const previousPath = join(parent, 'fix-review/evidence/fixed-authentication.json');
const previous = JSON.parse(readFileSync(previousPath));
assert.equal(previous.candidate, candidate);
const assets = join(parent, 'fix-review/.work/fixed');
const sourceBefore = snapshot(join(assets, 'source'));
const buildBefore = snapshot(join(assets, 'stage'));
assert.deepEqual(sourceBefore, previous.sourceBefore);
assert.deepEqual(buildBefore, previous.buildBefore);
for (const [name, sha256] of Object.entries(sourceBefore)) {
  const result = run('git', ['show', `${candidate}:${name}`], { encoding: null });
  assert.equal(result.status, 0, name);
  assert.equal(hash(result.stdout), sha256, name);
}
const archive = run('git', ['archive', candidate, 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json'], { encoding: null });
assert.equal(archive.status, 0);
assert.equal(hash(archive.stdout), previous.sourceArchiveHash);
assert.equal(digest(previous.moved), previous.tarHash);
assert.deepEqual(snapshot(join(assets, 'moved-consumer/node_modules/virtual-bash')), previous.packageBefore);
const scratch = join(owned, '.work');
assert.ok(!existsSync(scratch));
mkdirSync(scratch);
const consumer = join(scratch, 'moved-consumer');
mkdirSync(consumer);
copyFileSync(previous.moved, join(scratch, 'packed.tgz'));
renameSync(join(scratch, 'packed.tgz'), join(consumer, 'virtual-bash.tgz'));
assert.ok(!existsSync(join(scratch, 'packed.tgz')));
assert.equal(digest(join(consumer, 'virtual-bash.tgz')), previous.tarHash);
const installed = join(consumer, 'node_modules/virtual-bash');
mkdirSync(installed, { recursive: true });
assert.equal(run('tar', ['-xzf', join(consumer, 'virtual-bash.tgz'), '--strip-components=1', '-C', installed]).status, 0);
const packageBefore = snapshot(installed);
assert.deepEqual(packageBefore, buildBefore);
assert.deepEqual(packageBefore, previous.packageBefore);
for (const name of names) copyFileSync(join(author, name), join(consumer, name));
copyFileSync(join(owned, 'controls.mjs'), join(consumer, 'controls.mjs'));
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
const hashes = Object.fromEntries(Object.entries(packageBefore).map(([name, sha256]) => [join(installed, name), sha256]));
const hashPath = join(scratch, 'hashes.json');
writeFileSync(hashPath, JSON.stringify(hashes));
const runs = {};
for (const [label, filename, expectedCount] of [['controls', 'controls.mjs', 6], ['v2', 'public.mjs', 24]]) {
  const loadedPath = join(scratch, `${label}-loaded.jsonl`);
  const execution = run(process.execPath, ['--unhandled-rejections=strict', '--experimental-loader', join(owned, 'loader.mjs'), '--test', '--test-concurrency=1', '--test-reporter=tap', join(consumer, filename)], { cwd: consumer, env: { ...process.env,
    REVIEW_PACKAGE: installed, REVIEW_HASHES: hashPath, REVIEW_LOADED: loadedPath,
    REMAINING_PUBLIC: join(installed, 'dist/index.js'), REMAINING_ARCHIVE: join(installed, 'dist/commands/archive/index.js'), REMAINING_NETWORK: join(installed, 'dist/commands/network/index.js'), REMAINING_CANDIDATE: candidate } });
  add(join(owned, 'evidence', `${label}-execution.json`), execution);
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(label => {
    const line = execution.stdout.split('\n').find(line => line.startsWith(`# ${label} `));
    return [label, line ? Number(line.slice(label.length + 3)) : null];
  }));
  const loaded = readFileSync(loadedPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  for (const name of ['dist/index.js', 'dist/contracts/io.js', 'dist/commands/structured/input.js', 'dist/commands/structured/jq.js', 'dist/shell/shell.js']) assert.ok(loaded.some(entry => entry.path === join(installed, name)), name);
  runs[label] = { counts, loaded, status: execution.status, signal: execution.signal };
  assert.equal(execution.status, 0, `${label} failed`);
  assert.equal(execution.signal, null);
  assert.deepEqual(counts, { tests: expectedCount, pass: expectedCount, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
}
const currentPackage = JSON.parse(readFileSync(join(root, 'package.json')));
const discovered = globSync('tests/**/*.test.ts', { cwd: root, exclude: path => path === 'tests/commands/regex-execution/continuation/artifacts/native' }).sort();
assert.ok(!discovered.includes(relative(root, join(parent, 'public.mjs'))));
const discovery = { head, node: process.version, scripts: currentPackage.scripts, packageHash: digest(join(root, 'package.json')), exactGlob: "globSync('tests/**/*.test.ts', { exclude: path => path === 'tests/commands/regex-execution/continuation/artifacts/native' })", count: discovered.length, files: discovered,
  references: run('git', ['grep', '-n', '-F', 'public.mjs', '--', relative(root, parent), 'scripts', 'package.json']),
  qualification: 'Current explicit npm test glob selects .test.ts only; old public.mjs is historical explicit moved-package fixture. No claim about all possible Node discovery patterns or other profiles.' };
add(join(owned, 'evidence', 'discovery.json'), discovery);
const currentDifferences = run('git', ['diff', candidate, head, '--', 'src']);
const relevant = ['src/contracts/io.ts', 'src/contracts/command.md', 'src/commands/structured/jq.ts', 'src/commands/structured/input.ts', 'src/commands/network/body.ts', 'src/shell/shell.ts', 'src/shell/runtime.ts', 'src/shell/cleanup.ts'];
const relevantBinding = Object.fromEntries(relevant.map(name => [name, { accepted: sourceBefore[name], current: digest(join(root, name)) }]));
for (const entry of Object.values(relevantBinding)) assert.equal(entry.accepted, entry.current);
const fixtureAfter = Object.fromEntries(Object.keys(fixtureBefore).map(name => [name, digest(join(owned, name))]));
const authorAfter = Object.fromEntries(names.map(name => [name, digest(join(author, name))]));
const historicalAfter = Object.fromEntries(names.map(name => [name, digest(join(parent, name))]));
const sourceAfter = snapshot(join(assets, 'source'));
const buildAfter = snapshot(join(assets, 'stage'));
const packageAfter = snapshot(installed);
assert.deepEqual(fixtureBefore, fixtureAfter);
assert.deepEqual(authorBefore, authorAfter);
assert.deepEqual(historicalBefore, historicalAfter);
assert.deepEqual(sourceBefore, sourceAfter);
assert.deepEqual(buildBefore, buildAfter);
assert.deepEqual(packageBefore, packageAfter);
const liveAfter = snapshot(join(root, 'src'));
add(join(owned, 'evidence', 'authentication.json'), { candidate, authorCommit, head, previousEvidenceHash: digest(previousPath), previousBuildEvidence: JSON.parse(readFileSync(join(parent, 'fix-review/evidence/fixed-build.json'))), previousPackEvidenceHash: digest(join(parent, 'fix-review/evidence/fixed-pack.json')), sourceArchiveHash: hash(archive.stdout), tarHash: previous.tarHash,
  fixtureBefore, fixtureAfter, authorBefore, authorAfter, historicalBefore, historicalAfter, relevantBinding, currentDifferences, sourceBefore, sourceAfter, buildBefore, buildAfter, packageBefore, packageAfter, liveBefore, liveAfter, runs,
  resources: 'Each synchronous child has 180s parent timeout with SIGKILL, returned status0/signalnull. No servers or external network; Shell disposal awaited. Loader worker belongs to naturally exited test process.', node: process.version, platform: process.platform, arch: process.arch });
console.log(JSON.stringify({ candidate, authorCommit, controls: runs.controls.counts, v2: runs.v2.counts, discovered: discovered.length }));

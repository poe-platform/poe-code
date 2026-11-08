import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, copyFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { count } from './vectors.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const phase = process.argv[2];
assert.match(phase ?? '', /^[a-z0-9-]+$/);
const freeze = JSON.parse(readFileSync(join(owned, 'freeze.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = filename => hash(readFileSync(filename));
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 24 * 1024 * 1024, timeout: 120000, killSignal: 'SIGKILL', ...options });
  return { command: [command, ...args], status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
};
const evidence = (name, value) => {
  const filename = join(owned, 'evidence', `${phase}-${name}`);
  assert.ok(!existsSync(filename), 'append-only evidence');
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const result = run('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${relative(root, filename)}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n` });
  assert.equal(result.status, 0, result.stderr + result.stdout);
};
const snapshot = directory => Object.fromEntries(Object.keys(freeze.source).map(name => [name, digest(join(directory, name))]));
const fixtures = () => Object.fromEntries(Object.keys(freeze.fixtures).map(name => [name, digest(join(owned, name))]));
const fixturesBefore = fixtures();
assert.deepEqual(fixturesBefore, freeze.fixtures);
const liveBefore = snapshot(root);
const initialHead = run('git', ['rev-parse', 'HEAD']).stdout.trim();
evidence('binding.json', { candidate: freeze.candidate, initialHead, started: new Date().toISOString(), liveBefore, fixturesBefore,
  freezeHash: digest(join(owned, 'freeze.json')), status: run('git', ['status', '--short']).stdout,
  index: run('git', ['diff', '--cached', '--name-only']).stdout });
assert.deepEqual(liveBefore, freeze.preExecutionLive, 'live source mismatch since freeze; no rebaseline');
const scratch = join(owned, '.work', phase);
assert.ok(!existsSync(scratch), 'unique phase; preserve earlier attempts');
mkdirSync(scratch, { recursive: true });
const source = join(scratch, 'isolated-source');
mkdirSync(source);
const archive = spawnSync('git', ['archive', '--format=tar', freeze.candidate, 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md', 'AGENTS.md'],
  { cwd: root, timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 24 * 1024 * 1024 });
assert.equal(archive.status, 0, archive.stderr.toString());
const extraction = run('tar', ['-xf', '-', '-C', source], { input: archive.stdout });
assert.equal(extraction.status, 0, extraction.stderr);
const sourceBefore = snapshot(source);
assert.deepEqual(sourceBefore, freeze.source);
const stage = join(scratch, 'build-stage', 'virtual-bash');
mkdirSync(stage, { recursive: true });
const build = run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(source, 'tsconfig.build.json'), '--outDir', join(stage, 'dist')]);
evidence('build.json', build);
assert.equal(build.status, 0, 'build failure is not a test score');
for (const name of ['package.json', 'README.md']) copyFileSync(join(source, name), join(stage, name));
const packDirectory = join(scratch, 'pack-output');
mkdirSync(packDirectory);
const pack = run('npm', ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', packDirectory],
  { cwd: stage, env: { ...process.env, npm_config_cache: join(scratch, 'npm-cache') } });
evidence('pack.json', pack);
assert.equal(pack.status, 0, pack.stderr);
const packInfo = JSON.parse(pack.stdout);
assert.equal(packInfo.length, 1);
const consumer = join(scratch, 'remaining-byte-consumer');
mkdirSync(consumer);
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'remaining-byte-consumer', version: '1.0.0', type: 'module', private: true }));
const created = join(packDirectory, packInfo[0].filename);
const archiveHash = digest(created);
const moved = join(consumer, packInfo[0].filename);
renameSync(created, moved);
assert.ok(!existsSync(created));
assert.equal(digest(moved), archiveHash);
const destination = join(consumer, 'node_modules', 'virtual-bash');
mkdirSync(destination, { recursive: true });
const installed = run('tar', ['-xzf', moved, '--strip-components=1', '-C', destination]);
assert.equal(installed.status, 0, installed.stderr);
const packageSnapshot = () => Object.fromEntries(walk(destination).sort().map(name => [name, digest(name)]));
const packageHashes = packageSnapshot();
assert.deepEqual(Object.keys(packageHashes).map(name => relative(destination, name)).sort(), packInfo[0].files.map(entry => entry.path).sort());
for (const [name, sha256] of Object.entries(packageHashes)) assert.equal(sha256, digest(join(stage, relative(destination, name))));
assert.equal(digest(join(destination, 'package.json')), freeze.source['package.json']);
for (const name of ['public.mjs', 'vectors.mjs', 'fixtures.mjs', 'archives.json']) copyFileSync(join(owned, name), join(consumer, name));
const hashFile = join(scratch, 'package-hashes.json');
writeFileSync(hashFile, JSON.stringify(packageHashes));
const loadedFile = join(scratch, 'loaded.jsonl');
const env = { ...process.env, REMAINING_PUBLIC: join(destination, 'dist/index.js'), REMAINING_ARCHIVE: join(destination, 'dist/commands/archive/index.js'),
  REMAINING_NETWORK: join(destination, 'dist/commands/network/index.js'), REMAINING_HASHES: hashFile, REMAINING_LOADED: loadedFile, REMAINING_CANDIDATE: freeze.candidate };
const resolution = run(process.execPath, ['--input-type=module', '-e', 'console.log(import.meta.resolve("virtual-bash"))'], { cwd: consumer });
assert.equal(resolution.status, 0);
assert.equal(fileURLToPath(resolution.stdout.trim()), env.REMAINING_PUBLIC);
evidence('package.json', { archiveHash, moved, physicallyMoved: true, manifestHash: digest(join(destination, 'package.json')), resolution, installed, packageHashes });
const tests = run(process.execPath, ['--unhandled-rejections=strict', '--experimental-loader', join(owned, 'loaded-hashes.mjs'), '--test', '--test-concurrency=1', '--test-reporter=tap', join(consumer, 'public.mjs')], { cwd: consumer, env });
evidence('public.tap', tests.stdout + tests.stderr);
const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(label => {
  const line = tests.stdout.split('\n').find(item => item.startsWith(`# ${label} `));
  return [label, line ? Number(line.slice(label.length + 3)) : null];
}));
const sourceAfter = snapshot(source);
const liveAfter = snapshot(root);
const fixturesAfter = fixtures();
const loaded = existsSync(loadedFile) ? readFileSync(loadedFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
const finalHead = run('git', ['rev-parse', 'HEAD']).stdout.trim();
evidence('results.json', { candidate: freeze.candidate, initialHead, finalHead, finished: new Date().toISOString(), counts, tests,
  sourceBefore, sourceAfter, liveBefore, liveAfter, sourceMismatches: Object.keys(liveAfter).filter(name => liveAfter[name] !== freeze.source[name]),
  fixturesBefore, fixturesAfter, archiveHash, manifestHash: freeze.source['package.json'], packageHashes, loaded,
  closure: { childReturned: tests.status !== null, signal: tests.signal, error: tests.error, timeoutMs: 120000, killSignal: 'SIGKILL',
    detail: 'Synchronous non-detached build/pack/extract/test/marker children returned; no servers or external network created; test Shell disposals awaited. Natural child exit is required, not timeout termination.' },
  node: process.version, platform: process.platform, arch: process.arch, npm: run('npm', ['--version']).stdout.trim() });
assert.deepEqual(sourceAfter, sourceBefore);
assert.deepEqual(liveAfter, liveBefore, 'live source changed; recorded, not rebaselined');
assert.deepEqual(fixturesAfter, fixturesBefore);
assert.deepEqual(packageSnapshot(), packageHashes);
for (const name of ['dist/index.js', 'dist/commands/structured/input.js', 'dist/commands/structured/jq.js', 'dist/commands/search/shared.js', 'dist/commands/archive/stream.js', 'dist/commands/network/body.js']) {
  assert.ok(loaded.some(entry => entry.filename === join(destination, name)), `missing loaded asset: ${name}`);
}
assert.equal(counts.tests, count);
assert.equal(tests.signal, null);
assert.ok(tests.status === 0 || tests.status === 1);
console.log(JSON.stringify({ phase, candidate: freeze.candidate, counts, status: tests.status, archiveHash, initialHead, finalHead }, null, 2));
process.exitCode = tests.status;

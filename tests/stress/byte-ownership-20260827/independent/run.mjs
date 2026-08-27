import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, copyFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { counts } from './vectors.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const digest = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
};
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
const mapHashes = files => Object.fromEntries(files.sort().map(filename => [relative(root, filename), digest(filename)]));
const sourceSnapshot = () => mapHashes([
  ...walk(join(root, 'src')),
  ...['package.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/contracts/io.test.ts', 'AGENTS.md'].map(filename => join(root, filename)),
]);
const frozenNames = ['vectors.mjs', 'fixtures.mjs', 'internal.mjs', 'public.mjs', 'loaded-hashes.mjs', 'run.mjs', 'README.md', '.gitignore', 'consumer-package.json', 'scaffolding-correction.md'];
const freezeName = 'freeze-scaffold-v3.json';
const fixtureSnapshot = () => mapHashes(frozenNames.map(filename => join(owned, filename)));
const addEvidence = (name, content) => {
  const filename = relative(root, join(owned, name));
  assert.ok(!existsSync(join(root, filename)), `Evidence is append-only: ${filename}`);
  const patch = `*** Begin Patch\n*** Add File: ${filename}\n${content.replace(/\n$/, '').split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
  const result = run('apply_patch', [patch]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
};

if (process.argv[2] === '--freeze') {
  const source = sourceSnapshot();
  const binding = {
    phase: 'FROZEN before product execution',
    timestamp: new Date().toISOString(),
    head: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
    source, fixtures: fixtureSnapshot(), counts,
    node: process.version, platform: process.platform, arch: process.arch,
    status: run('git', ['status', '--short']).stdout,
  };
  addEvidence(freezeName, JSON.stringify(binding, null, 2));
  console.log(JSON.stringify({ counts, freezeSha256: digest(join(owned, freezeName)), sourceFiles: Object.keys(source).length }));
} else {
  const phase = process.argv[2];
  assert.match(phase ?? '', /^[a-z][a-z0-9-]*$/);
  const freeze = JSON.parse(readFileSync(join(owned, freezeName), 'utf8'));
  assert.deepEqual(fixtureSnapshot(), freeze.fixtures, 'frozen holdout files changed');
  const before = sourceSnapshot();
  if (phase.startsWith('prepatch')) assert.deepEqual(before, freeze.source, 'source changed before baseline');
  const scratch = join(owned, '.work', phase);
  assert.ok(!existsSync(scratch), 'use a unique phase; do not erase previous attempts');
  const staged = join(scratch, 'staged', 'virtual-bash');
  mkdirSync(staged, { recursive: true });
  const buildArgs = [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.build.json'), '--outDir', join(staged, 'dist')];
  const build = run(process.execPath, buildArgs);
  addEvidence(`evidence/${phase}-build.txt`, JSON.stringify({ command: [process.execPath, ...buildArgs], ...build }, null, 2));
  assert.equal(build.status, 0, 'HARNESS/BUILD ERROR, not a product test failure');
  assert.deepEqual(sourceSnapshot(), before, 'source changed during build');
  copyFileSync(join(root, 'package.json'), join(staged, 'package.json'));
  const consumer = join(scratch, 'moved', 'consumer');
  const destination = join(consumer, 'node_modules', 'virtual-bash');
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(owned, 'consumer-package.json'), join(consumer, 'package.json'));
  renameSync(staged, destination);
  assert.ok(!existsSync(staged));
  for (const filename of ['public.mjs', 'internal.mjs', 'vectors.mjs', 'fixtures.mjs']) copyFileSync(join(owned, filename), join(consumer, filename));
  const packageFiles = walk(destination);
  const packageHashes = Object.fromEntries(packageFiles.map(filename => [filename, digest(filename)]));
  const hashFile = join(scratch, 'package-hashes.json');
  writeFileSync(hashFile, JSON.stringify(packageHashes));
  const loadedLog = join(scratch, 'loaded.jsonl');
  const env = {
    ...process.env,
    OWNERSHIP_PUBLIC: join(destination, 'dist/index.js'),
    OWNERSHIP_INTERNAL: join(destination, 'dist/commands/internal.js'),
    OWNERSHIP_PACKAGE_HASHES: hashFile,
    OWNERSHIP_LOADED_LOG: loadedLog,
  };
  const results = {};
  for (const cohort of ['internal', 'public']) {
    const args = ['--unhandled-rejections=strict', '--experimental-loader', join(owned, 'loaded-hashes.mjs'), '--test', '--test-concurrency=1', '--test-reporter=tap', join(consumer, `${cohort}.mjs`)];
    const started = performance.now();
    const result = run(process.execPath, args, { cwd: consumer, env, timeout: 90000 });
    results[cohort] = { command: [process.execPath, ...args], status: result.status, signal: result.signal, elapsedMs: performance.now() - started };
    addEvidence(`evidence/${phase}-${cohort}.tap`, result.stdout + result.stderr);
    const count = Number(/^# tests (\d+)$/m.exec(result.stdout)?.[1]);
    assert.equal(count, counts[cohort], `HARNESS ERROR: ${cohort} discovered ${count}, expected ${counts[cohort]}`);
    results[cohort].counts = {
      tests: count,
      pass: Number(/^# pass (\d+)$/m.exec(result.stdout)?.[1]),
      fail: Number(/^# fail (\d+)$/m.exec(result.stdout)?.[1]),
      cancelled: Number(/^# cancelled (\d+)$/m.exec(result.stdout)?.[1]),
      skipped: Number(/^# skipped (\d+)$/m.exec(result.stdout)?.[1]),
    };
  }
  assert.deepEqual(sourceSnapshot(), before, 'source changed during verification');
  assert.deepEqual(fixtureSnapshot(), freeze.fixtures, 'holdouts changed during verification');
  assert.deepEqual(Object.fromEntries(packageFiles.map(filename => [filename, digest(filename)])), packageHashes, 'moved package changed');
  const loaded = readFileSync(loadedLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  for (const filename of ['dist/index.js', 'dist/commands/internal.js', 'dist/commands/streams.js']) {
    assert.ok(loaded.some(record => record.filename === join(destination, filename)), `missing loaded module: ${filename}`);
  }
  const evidence = {
    phase, timestamp: new Date().toISOString(), head: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
    freezeSha256: digest(join(owned, freezeName)), source: before,
    changedSinceFreeze: Object.keys(before).filter(filename => before[filename] !== freeze.source[filename]),
    sourceUnchangedDuringRun: true, fixturesUnchanged: true,
    sourceWasMoved: false, packageWasMoved: true, movedPackageUnchanged: true,
    packageHashes, loaded, results, node: process.version, platform: process.platform, arch: process.arch,
    observation: 'Wall time includes loader verification and test harness. No allocation instrumentation or matched performance comparison; not a performance claim.',
  };
  addEvidence(`evidence/${phase}-results.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ phase, results }, null, 2));
  process.exitCode = Object.values(results).some(result => result.status !== 0) ? 1 : 0;
}

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = realpathSync(process.cwd());
assert.equal(repository, '/Users/kjopek/Workspace/safe-bash');
const [variant = 'baseline', routedCommit, cohortVersion = 'v1'] = process.argv.slice(2);
assert.ok(['baseline', 'candidate'].includes(variant));
assert.ok(['v1', 'v2'].includes(cohortVersion));
const freeze = JSON.parse(readFileSync(directory + 'freeze.json'));
const cohortFreeze = cohortVersion === 'v2' ? JSON.parse(readFileSync(directory + 'freeze-v2.json')) : freeze;
const expectedFilename = cohortVersion === 'v2' ? 'expected-v2.json' : 'expected.json';
const commit = variant === 'baseline' ? freeze.baselineCommit : routedCommit;
assert.match(commit ?? '', /^[a-f0-9]{40}$/u);
if (variant === 'candidate') {
  const route = readFileSync('/tmp/sort-unkeyed-review-coordination.txt', 'utf8');
  assert.ok(route.includes(commit), 'candidate must be explicitly root-routed');
}
const git = args => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const scratch = realpathSync(mkdtempSync('/tmp/sort-unkeyed-review-' + variant + '-'));
const evidence = directory + variant + '-' + commit.slice(0, 12) + (cohortVersion === 'v2' ? '-v2' : '');
assert.equal(existsSync(evidence), false, 'evidence is immutable, choose an explicit new attempt rather than overwrite');
mkdirSync(evidence);
const sourceRoot = join(scratch, 'source');
mkdirSync(sourceRoot);
const commands = [];
async function bounded(command, args, cwd, env = process.env) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  const errors = [];
  let bytes = 0;
  let terminated;
  const deadline = setTimeout(() => { terminated = '90s wall watchdog'; child.kill('SIGKILL'); }, 90000);
  const collect = target => chunk => {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) { terminated = '8MiB log bound'; child.kill('SIGKILL'); }
    else target.push(chunk);
  };
  child.stdout.on('data', collect(output));
  child.stderr.on('data', collect(errors));
  let spawnError;
  child.on('error', error => { spawnError = error; });
  const closed = await new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  clearTimeout(deadline);
  const stdout = Buffer.concat(output).toString();
  const stderr = Buffer.concat(errors).toString();
  const result = { command, args, cwd, pid: child.pid, ...closed, bytes, terminated, stdout, stderr, spawnError: spawnError?.message, exactChildClosed: true };
  commands.push(result);
  writeFileSync(evidence + '/commands.json', JSON.stringify(commands, null, 2) + '\n');
  assert.equal(terminated, undefined, terminated);
  assert.equal(spawnError, undefined);
  assert.equal(closed.code, 0, stderr || stdout);
  return stdout;
}
function inventory(root, sub = '') {
  return readdirSync(join(root, sub), { withFileTypes: true }).flatMap(entry => {
    const path = join(sub, entry.name);
    assert.ok(!entry.isSymbolicLink(), path);
    return entry.isDirectory() ? inventory(root, path) : [{ path, bytes: readFileSync(join(root, path)).length, sha256: hash(readFileSync(join(root, path))) }];
  }).sort((left, right) => left.path.localeCompare(right.path));
}
const selectedFiles = git(['ls-tree', '-r', '--name-only', commit, 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json']).toString().trim().split('\n');
const sources = selectedFiles.map(path => {
  const bytes = git(['show', `${commit}:${path}`]);
  const destination = join(sourceRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { flag: 'wx' });
  return { path, bytes: bytes.length, sha256: hash(bytes) };
});
if (variant === 'baseline') assert.deepEqual(sources, freeze.sources);
const acceptancePath = join(scratch, 'workloads.json');
const expectedPath = join(scratch, 'expected.json');
const acceptance = git(['show', `${freeze.acceptanceCommit}:benchmarks/reports/sort-performance-next-20260827/workloads.json`]);
assert.equal(hash(acceptance), freeze.acceptanceHash);
assert.equal(hash(readFileSync(directory + expectedFilename)), cohortFreeze.expectedSha256);
assert.equal(hash(readFileSync(directory + 'holdouts.mjs')), freeze.holdoutsSha256);
writeFileSync(acceptancePath, acceptance);
copyFileSync(directory + expectedFilename, expectedPath);
const compiler = realpathSync(join(repository, 'node_modules/typescript/bin/tsc'));
const compilerInfo = { path: compiler, sha256: hash(readFileSync(compiler)), implementationSha256: hash(readFileSync(join(dirname(compiler), '../lib/_tsc.js'))), packageSha256: hash(readFileSync(join(dirname(compiler), '../package.json'))) };
writeFileSync(evidence + '/admission.json', JSON.stringify({ variant, commit, tree: git(['rev-parse', `${commit}^{tree}`]).toString().trim(), scratch, sourceRoot, sources, compilerInfo, inputHashes: { acceptance: hash(acceptance), expected: hash(readFileSync(expectedPath)) }, runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), workerSha256: hash(readFileSync(directory + 'public-worker.mjs')), profile: { heapMiB: 512, childWallSeconds: 90, childLogBytes: 8388608, execAbortMilliseconds: 5000, outputBytes: 4194304 }, claims: 'No timing or speed measurements; isolated build uses repository compiler only.' }, null, 2) + '\n');
try {
  await bounded(process.execPath, ['--max-old-space-size=512', compiler, '-p', join(sourceRoot, 'tsconfig.build.json'), '--typeRoots', join(repository, 'node_modules/@types')], scratch);
  const packedOutput = await bounded('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch, '--cache', join(scratch, 'npm-cache')], sourceRoot);
  const packed = JSON.parse(packedOutput)[0];
  const archive = join(scratch, packed.filename);
  const extraction = join(scratch, 'unpack');
  mkdirSync(extraction);
  await bounded('tar', ['-xf', archive, '-C', extraction], scratch);
  const beforeMove = inventory(join(extraction, 'package'));
  const firstConsumer = join(scratch, 'first-location');
  mkdirSync(join(firstConsumer, 'node_modules'), { recursive: true });
  renameSync(join(extraction, 'package'), join(firstConsumer, 'node_modules/virtual-bash'));
  copyFileSync(directory + 'public-worker.mjs', join(firstConsumer, 'public-worker.mjs'));
  const consumer = join(scratch, 'moved-public-consumer');
  renameSync(firstConsumer, consumer);
  assert.equal(existsSync(firstConsumer), false);
  const movedPackage = join(consumer, 'node_modules/virtual-bash');
  assert.deepEqual(inventory(movedPackage), beforeMove);
  const packageManifestPath = join(scratch, 'package-manifest.json');
  writeFileSync(packageManifestPath, JSON.stringify(beforeMove, null, 2) + '\n');
  copyFileSync(packageManifestPath, evidence + '/package-manifest.json');
  const resultBytes = await bounded(process.execPath, ['--max-old-space-size=512', join(consumer, 'public-worker.mjs'), movedPackage, acceptancePath, expectedPath, packageManifestPath], consumer);
  const result = JSON.parse(resultBytes);
  writeFileSync(evidence + '/results.json', JSON.stringify(result, null, 2) + '\n');
  for (const source of sources) {
    assert.equal(hash(readFileSync(join(sourceRoot, source.path))), source.sha256);
    assert.equal(hash(git(['show', `${commit}:${source.path}`])), source.sha256);
  }
  assert.deepEqual(inventory(movedPackage), beforeMove);
  assert.equal(hash(readFileSync(acceptancePath)), freeze.acceptanceHash);
  assert.equal(hash(readFileSync(expectedPath)), cohortFreeze.expectedSha256);
  const failed = result.rows.filter(row => !row.passed);
  const summary = { variant, commit, cohortVersion, scratch, archiveSha256: hash(readFileSync(archive)), packageFiles: beforeMove.length, loadedModules: result.modules.length, acceptance: { passed: result.rows.filter(row => row.cohort === 'acceptance21' && row.passed).length, total: 21 }, independent: { passed: result.rows.filter(row => row.cohort.startsWith('independent') && row.passed).length, total: result.rows.filter(row => row.cohort.startsWith('independent')).length }, failed: failed.map(row => row.id), sourceBeforeAfterEqual: true, packageBeforeAfterEqual: true, exactChildClosure: commands.every(command => command.exactChildClosed), shellsDisposed: result.shellsDisposed, candidateAcceptance: false };
  writeFileSync(evidence + '/summary.json', JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  if (failed.length) process.exitCode = 1;
} catch (error) {
  writeFileSync(evidence + '/failure.json', JSON.stringify({ message: error.message, stack: error.stack, commandsClosed: commands.every(command => command.exactChildClosed) }, null, 2) + '\n');
  throw error;
}

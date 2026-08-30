import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { baselineCommit } from './profile.mjs';

const own = dirname(fileURLToPath(import.meta.url));
const repo = resolve(own, '../../..');
const [mode, commit, receiptName] = process.argv.slice(2);
assert.ok(['baseline', 'candidate'].includes(mode));
assert.match(commit, /^[a-f0-9]{40}$/);
assert.match(receiptName, /^[a-z0-9-]+$/);
const output = join(own, receiptName);
assert.equal(existsSync(output), false, 'capture must use a fresh receipt directory');
mkdirSync(output);
const scratch = mkdtempSync(join(own, '.scratch-'));
const commands = [];
const childEnvironment = { PATH: process.env.PATH, HOME: scratch, LANG: 'C', TZ: 'UTC', NODE_OPTIONS: '', NODE_PATH: '',
  npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
  npm_config_userconfig: join(scratch, 'empty-npmrc'), npm_config_cache: join(scratch, 'npm-cache') };
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: scratch, encoding: 'utf8', timeout: 120000,
    maxBuffer: 20 * 1024 * 1024, env: childEnvironment, ...options });
  commands.push({ command, args, status: result.status, signal: result.signal,
    stdout: typeof result.stdout === 'string' ? result.stdout.trim().slice(0, 2500) : undefined,
    stderr: typeof result.stderr === 'string' ? result.stderr.trim().slice(0, 6000) : undefined });
  if (result.error) throw result.error;
  if (!options.allowFailure) assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  return result;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function manifest(directory) {
  const items = [];
  function visit(relative) {
    const path = join(directory, relative);
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      items.push([relative, 'directory']);
      for (const entry of readdirSync(path).sort()) visit(join(relative, entry));
    } else {
      assert.equal(stat.isFile(), true, 'no symlink escape in frozen tree');
      items.push([relative, stat.size, hash(readFileSync(path))]);
    }
  }
  visit('');
  return { entries: items.length, sha256: hash(JSON.stringify(items)) };
}
const receipt = { mode, commit, baselineCommit, started: new Date().toISOString(), commands,
  scope: 'Exact Git archive of all src plus package/build configuration; not whole repository gate',
  tools: { node: process.version, tsc: hash(readFileSync(join(repo, 'node_modules/typescript/lib/_tsc.js'))) },
  frozenProfile: hash(readFileSync(join(own, 'profile.mjs'))) };
const harnessFiles = ['verify.mjs', 'entry.mjs', 'runtime.mjs', 'profile.mjs', 'offline.mjs',
  'consumer.mts', 'mutations.mjs', 'mutation-entry.mjs'];
const harnessHashes = () => Object.fromEntries(harnessFiles.map(name => [name, hash(readFileSync(join(own, name)))]));
receipt.harnessBefore = harnessHashes();
try {
  if (mode === 'candidate') {
    const marker = readFileSync('/tmp/curl-zero-caps-author-candidate.txt');
    const sealed = JSON.parse(marker);
    assert.equal(sealed.candidate, commit);
    receipt.markerBefore = hash(marker);
    receipt.parent = run('git', ['rev-parse', `${commit}^`], { cwd: repo }).stdout.trim();
    assert.equal(receipt.parent, sealed.parent);
    receipt.sourceTree = run('git', ['rev-parse', `${commit}:src`], { cwd: repo }).stdout.trim();
    assert.equal(receipt.sourceTree, sealed.sourceTree);
    const changed = run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', commit], { cwd: repo }).stdout.trim().split('\n');
    assert.deepEqual(changed, ['src/commands/network/README.md', 'src/commands/network/shared.ts', 'tests/commands/network/zero-caps.test.ts']);
    receipt.changedPaths = changed;
    receipt.sourceHashes = {};
    for (const path of ['src/commands/network/README.md', 'src/commands/network/shared.ts']) {
      const bytes = run('git', ['show', `${commit}:${path}`], { cwd: repo, encoding: null }).stdout;
      receipt.sourceHashes[path] = hash(bytes);
      assert.equal(hash(bytes), sealed.sha256[path]);
    }
    const validatorBefore = run('git', ['show', `${receipt.parent}:src/commands/network/shared.ts`], { cwd: repo }).stdout;
    const validatorAfter = run('git', ['show', `${commit}:src/commands/network/shared.ts`], { cwd: repo }).stdout;
    assert.equal(validatorBefore.split('export async function withSignal')[1], validatorAfter.split('export async function withSignal')[1]);
    assert.equal(validatorBefore.split('export function limitsFor')[0], validatorAfter.split('export function limitsFor')[0]);
  }
  const archive = join(scratch, 'archive');
  mkdirSync(archive);
  const input = run('git', ['archive', '--format=tar', commit, 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'],
    { cwd: repo, encoding: null }).stdout;
  receipt.gitArchiveSha256 = hash(input);
  run('tar', ['-xf', '-', '-C', archive], { input });
  receipt.archiveBefore = manifest(archive);
  const built = join(scratch, 'built');
  mkdirSync(built);
  cpSync(join(archive, 'package.json'), join(built, 'package.json'));
  run(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '-p', join(archive, 'tsconfig.build.json'),
    '--outDir', join(built, 'dist'), '--typeRoots', join(repo, 'node_modules/@types')]);
  const runtimeOutput = join(output, 'runtime.json');
  const runtime = run(process.execPath, [join(own, 'entry.mjs')], { allowFailure: true,
    env: { ...childEnvironment, REVIEW_BASELINE: mode === 'baseline' ? '1' : '0',
      REVIEW_ROOT_IMPORT: pathToFileURL(join(built, 'dist/index.js')).href,
      REVIEW_NETWORK_IMPORT: pathToFileURL(join(built, 'dist/commands/network/index.js')).href,
      REVIEW_OUTPUT: runtimeOutput } });
  receipt.runtimeStatus = runtime.status;
  receipt.runtimeCounts = JSON.parse(readFileSync(runtimeOutput, 'utf8')).counts;
  receipt.archiveAfter = manifest(archive);
  assert.deepEqual(receipt.archiveAfter, receipt.archiveBefore, 'archive namespace and bytes unchanged');
  if (mode === 'candidate') {
    const packed = run('npm', ['pack', '--offline', '--ignore-scripts', '--json'], { cwd: built });
    const packInfo = JSON.parse(packed.stdout)[0];
    const tarball = join(built, packInfo.filename);
    receipt.package = { name: packInfo.name, version: packInfo.version, sha256: hash(readFileSync(tarball)),
      integrity: packInfo.integrity, files: packInfo.files.length };
    const install = join(scratch, 'install');
    mkdirSync(install);
    writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], { cwd: install });
    const moved = join(scratch, 'moved', 'consumer');
    mkdirSync(dirname(moved));
    renameSync(install, moved);
    for (const name of ['entry.mjs', 'offline.mjs', 'runtime.mjs', 'profile.mjs', 'consumer.mts', 'mutation-entry.mjs', 'mutations.mjs']) cpSync(join(own, name), join(moved, name));
    const installed = join(moved, 'node_modules/virtual-bash');
    const metadata = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
    assert.equal(existsSync(join(installed, 'src')), false);
    assert.deepEqual(readdirSync(join(moved, 'node_modules')).filter(name => !name.startsWith('.')), ['virtual-bash']);
    receipt.installedBefore = manifest(installed);
    rmSync(archive, { recursive: true });
    rmSync(built, { recursive: true });
    const movedRuntime = run(process.execPath, ['--permission', `--allow-fs-read=${moved}`,
      `--allow-fs-write=${join(output, 'moved-runtime.json')}`, join(moved, 'entry.mjs')], { cwd: moved, allowFailure: true,
      env: { ...childEnvironment, REVIEW_OUTPUT: join(output, 'moved-runtime.json') } });
    receipt.movedRuntimeStatus = movedRuntime.status;
    const movedReceipt = JSON.parse(readFileSync(join(output, 'moved-runtime.json'), 'utf8'));
    receipt.movedRuntimeCounts = movedReceipt.counts;
    assert.equal(movedReceipt.rootResolution, pathToFileURL(join(installed, 'dist/index.js')).href);
    assert.equal(movedReceipt.networkResolution, pathToFileURL(join(installed, 'dist/commands/network/index.js')).href);
    run(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '--strict', '--outDir', join(moved, 'typed'),
      '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023',
      '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax',
      '--typeRoots', join(repo, 'node_modules/@types'), join(moved, 'consumer.mts')], { cwd: moved });
    run(process.execPath, ['--permission', `--allow-fs-read=${moved}`, '--import', join(moved, 'offline.mjs'), join(moved, 'typed/consumer.mjs')], { cwd: moved });
    receipt.strictConsumer = 'passed';
    run(process.execPath, ['--permission', `--allow-fs-read=${moved}`,
      `--allow-fs-write=${join(output, 'mutations.json')}`, join(moved, 'mutation-entry.mjs')], { cwd: moved,
      env: { ...childEnvironment, REVIEW_OUTPUT: join(output, 'mutations.json') } });
    receipt.mutations = JSON.parse(readFileSync(join(output, 'mutations.json'), 'utf8'));
    receipt.installedAfter = manifest(installed);
    assert.deepEqual(receipt.installedBefore, receipt.installedAfter);
    receipt.markerAfter = hash(readFileSync('/tmp/curl-zero-caps-author-candidate.txt'));
    assert.equal(receipt.markerAfter, receipt.markerBefore);
  }
} catch (error) { receipt.harnessFailure = String(error.stack ?? error); process.exitCode = 1; }
finally {
  receipt.harnessAfter = harnessHashes();
  if (JSON.stringify(receipt.harnessBefore) !== JSON.stringify(receipt.harnessAfter)) {
    receipt.harnessChangedDuringRun = true;
    process.exitCode = 1;
  }
  rmSync(scratch, { recursive: true, force: true });
  receipt.scratchRemoved = !existsSync(scratch);
  receipt.finished = new Date().toISOString();
  writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
}
console.log(JSON.stringify({ runtime: receipt.runtimeCounts, moved: receipt.movedRuntimeCounts, error: receipt.harnessFailure }));
if (receipt.runtimeStatus || receipt.movedRuntimeStatus) process.exitCode = 1;

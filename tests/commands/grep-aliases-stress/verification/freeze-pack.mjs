import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const repository = '/Users/kjopek/Workspace/safe-bash';
const destination = process.argv[2];
const candidate = process.argv[3] ?? 'c9bd0dbb05553dc1f1cf9136a4e11ed6a3767bc8';
assert.ok(destination);
mkdirSync(destination, { recursive: false });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const environment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(destination, 'home'), TMPDIR: destination, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', npm_config_cache: join(destination, 'npm-cache'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
mkdirSync(environment.HOME);
const receipt = { candidate, startedAt: new Date().toISOString(), repository, destination, productOverlay: false, candidateExecutions: 0, commands: [], dependencies: [], sourceManifest: [], packageManifest: [], status: 'in-progress' };
function run(name, executable, args, cwd = destination, options = {}) {
  const child = spawnSync(executable, args, { cwd, env: environment, encoding: null, timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, ...options });
  const captured = { name, executable, args, cwd, status: child.status, signal: child.signal, error: child.error?.message ?? null, stdoutHex: (child.stdout ?? Buffer.alloc(0)).toString('hex'), stderrHex: (child.stderr ?? Buffer.alloc(0)).toString('hex') };
  receipt.commands.push(captured);
  writeFileSync(join(destination, `${name}.json`), `${JSON.stringify(captured, null, 2)}\n`);
  assert.equal(child.error, undefined, name);
  assert.equal(child.signal, null, name);
  assert.equal(child.status, 0, `${name}: ${child.stderr?.toString()} ${child.stdout?.toString()}`);
  return child.stdout;
}
function manifest(directory, relative = '') {
  return readdirSync(join(directory, relative)).sort().flatMap(name => {
    const path = join(relative, name);
    const metadata = lstatSync(join(directory, path));
    assert.equal(metadata.isSymbolicLink(), false, path);
    return metadata.isDirectory() ? manifest(directory, path) : [{ path, size: metadata.size, sha256: sha256(readFileSync(join(directory, path))) }];
  });
}
try {
  receipt.liveStatusAtStart = run('live-status', 'git', ['status', '--short'], repository).toString();
  const inputs = ['src', 'package.json', 'package-lock.json', 'README.md', 'tsconfig.json', 'tsconfig.build.json'];
  const archive = run('git-archive', 'git', ['archive', '--format=tar', candidate, '--', ...inputs], repository);
  receipt.archiveSha256 = sha256(archive);
  receipt.archiveScope = inputs;
  writeFileSync(join(destination, 'candidate.tar'), archive);
  const source = join(destination, 'source');
  mkdirSync(source);
  run('extract-source', '/usr/bin/tar', ['-xf', join(destination, 'candidate.tar'), '-C', source]);
  receipt.sourceManifest = manifest(source);
  const tracked = run('git-input-list', 'git', ['ls-tree', '-r', '--name-only', candidate, '--', ...inputs], repository).toString().trim().split('\n').sort();
  assert.deepEqual(receipt.sourceManifest.map(entry => entry.path).sort(), tracked);
  for (const entry of receipt.sourceManifest) {
    const expected = spawnSync('git', ['show', `${candidate}:${entry.path}`], { cwd: repository, maxBuffer: 4 * 1024 * 1024, timeout: 5000 });
    assert.equal(expected.status, 0, entry.path);
    assert.equal(sha256(expected.stdout), entry.sha256, entry.path);
  }
  receipt.aliasSourceSha256 = sha256(readFileSync(join(source, 'src/commands/grep-aliases/index.ts')));
  if (candidate.startsWith('c9bd0dbb')) assert.equal(receipt.aliasSourceSha256, '61da567865598900545a4bbff2184ce5c68eb0c7e0347e7236e9f92789372c0a');
  const lock = JSON.parse(readFileSync(join(source, 'package-lock.json'), 'utf8'));
  const installedLock = JSON.parse(readFileSync(join(repository, 'node_modules/.package-lock.json'), 'utf8'));
  receipt.packageLockSha256 = sha256(readFileSync(join(source, 'package-lock.json')));
  mkdirSync(join(source, 'node_modules/@types'), { recursive: true });
  for (const name of ['typescript', '@types/node', 'undici-types']) {
    const metadata = lock.packages[`node_modules/${name}`];
    assert.equal(metadata.integrity, installedLock.packages[`node_modules/${name}`].integrity);
    assert.equal(metadata.version, installedLock.packages[`node_modules/${name}`].version);
    const digest = Buffer.from(metadata.integrity.split('-')[1], 'base64').toString('hex');
    const cache = join('/Users/kjopek/.npm/_cacache/content-v2/sha512', digest.slice(0, 2), digest.slice(2, 4), digest.slice(4));
    const cached = readFileSync(cache);
    assert.equal(`sha512-${createHash('sha512').update(cached).digest('base64')}`, metadata.integrity);
    const verify = join(destination, `dependency-${name.replaceAll('/', '-')}`);
    mkdirSync(verify);
    const listing = run(`list-${name.replaceAll('/', '-')}`, '/usr/bin/tar', ['-tzf', cache]).toString();
    assert.ok(listing.split('\n').filter(Boolean).every(path => !path.startsWith('/') && !path.split('/').includes('..')));
    run(`extract-${name.replaceAll('/', '-')}`, '/usr/bin/tar', ['-xzf', cache, '--strip-components=1', '-C', verify]);
    const expected = manifest(verify);
    const installed = join(repository, 'node_modules', name);
    assert.deepEqual(manifest(installed), expected, name);
    assert.equal(JSON.parse(readFileSync(join(installed, 'package.json'))).version, metadata.version);
    symlinkSync(installed, join(source, 'node_modules', name), 'dir');
    receipt.dependencies.push({ name, version: metadata.version, integrity: metadata.integrity, cacheSha256: sha256(cached), installed, installedManifestSha256: sha256(JSON.stringify(expected)), fileCount: expected.length, readonlyReuse: true, installedBytesEqualLockedTarball: true });
  }
  run('build', process.execPath, [join(source, 'node_modules/typescript/lib/tsc.js'), '-p', 'tsconfig.build.json'], source);
  receipt.sourceManifestAfterBuild = receipt.sourceManifest.map(entry => ({ ...entry, sha256: sha256(readFileSync(join(source, entry.path))) }));
  assert.deepEqual(receipt.sourceManifestAfterBuild, receipt.sourceManifest);
  const packageJson = JSON.parse(readFileSync(join(source, 'package.json')));
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  receipt.runtimeDependencies = packageJson.dependencies ?? {};
  receipt.aliasPublicSubpathExists = Object.hasOwn(packageJson.exports, './commands/grep-aliases');
  const packOutput = run('pack-offline', 'npm', ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', destination], source).toString();
  const packed = JSON.parse(packOutput)[0];
  const tarball = join(destination, packed.filename);
  receipt.packageSha256 = sha256(readFileSync(tarball));
  receipt.packageIntegrity = packed.integrity;
  const staging = join(destination, 'staging');
  mkdirSync(staging);
  run('extract-package', '/usr/bin/tar', ['-xzf', tarball, '-C', staging]);
  const consumer = join(destination, 'physically-moved-offline-consumer');
  mkdirSync(join(consumer, 'node_modules'), { recursive: true });
  renameSync(join(staging, 'package'), join(consumer, 'node_modules/virtual-bash'));
  assert.equal(existsSync(join(staging, 'package')), false);
  receipt.consumer = consumer;
  const packageRoot = join(consumer, 'node_modules/virtual-bash');
  receipt.packageManifest = manifest(packageRoot);
  receipt.publicRootEntrySha256 = sha256(readFileSync(join(packageRoot, 'dist/index.js')));
  receipt.internalAliasEntrySha256 = sha256(readFileSync(join(packageRoot, 'dist/commands/grep-aliases/index.js')));
  receipt.workerEntrySha256 = sha256(readFileSync(join(packageRoot, 'dist/commands/regex-execution/worker.js')));
  receipt.archiveSha256AfterBuild = sha256(readFileSync(join(destination, 'candidate.tar')));
  assert.equal(receipt.archiveSha256AfterBuild, receipt.archiveSha256);
  receipt.status = 'built-and-physically-moved-no-candidate-run';
} catch (error) {
  receipt.status = 'failed';
  receipt.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  receipt.endedAt = new Date().toISOString();
  writeFileSync(join(destination, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, candidate, archiveSha256: receipt.archiveSha256, packageSha256: receipt.packageSha256, consumer: receipt.consumer, error: receipt.failure?.message }, null, 2));
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const reportRoot = dirname(fileURLToPath(import.meta.url));
const repository = resolve(reportRoot, '../../../..');
const reportRelative = relative(repository, reportRoot);
const candidate = 'e33974b8c643077453227a9679d8ceca8367998c';
const candidateTree = 'f559246f1317af7691de00333e13dfc8f44ef428';
const primary = '010411eff3dd210b9575e061914efccd65c13547';
const prefix = 'benchmarks/reports/current-comparison-20260827';
const authentication = 'benchmarks/reports/comparison-fairness-20260827/published-artifact-authentication';
const requiredAncestors = ['1ad428ed', '7d7dce7c', 'b2821599', '3bf672f', 'c3fbda62', '84ab66ca'];
const runtimeNames = ['run.mjs', 'binding.mjs', 'cohorts.mjs', 'io.mjs', 'limits.mjs', 'supervise.mjs', 'session.mjs', 'engine-child.mjs', 'expanded.mjs', 'breadth.mjs', 'network.mjs', 'observe-load.mjs', 'assessment.mjs', 'reuse/expanded-common.mjs', 'reuse/breadth-assess.mjs'];
const staticNames = ['run.mjs', 'binding.mjs', 'cohorts.mjs', 'io.mjs', 'limits.mjs', 'supervise.mjs', 'assessment.mjs', 'reuse/expanded-common.mjs', 'reuse/breadth-assess.mjs'];
const sourceSelections = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md', '.gitignore', 'AGENTS.md'];
const git = '/usr/bin/git';
const patch = process.env.FREEZE_APPLY_PATCH;
assert.ok(patch?.startsWith('/'), 'explicit apply_patch tool required');
let scratch;
let phase = 'ancestry';
let hashedBytes = 0;
const processes = [];
const evidence = [];
const gitReads = [];
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const json = bytes => JSON.parse(bytes.toString('utf8'));
const record = (path, bytes, extra = {}) => ({ path, bytes: bytes.length, sha256: digest(bytes), ...extra });

function gitRead(args, maximum = 16 * 1024 * 1024) {
  const bytes = execFileSync(git, args, { cwd: repository, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, timeout: 30000, maxBuffer: maximum });
  gitReads.push({ args, bytes: bytes.length, sha256: digest(bytes) });
  return bytes;
}
const gitFile = (revision, path) => gitRead(['show', `${revision}:${path}`]);

async function publish(name, value) {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  const target = join(reportRoot, name);
  try { await lstat(target); throw new Error(`Refuse overwrite: ${target}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  execFileSync(patch, [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${reportRelative}/${name}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`, maxBuffer: 65536 });
  const bytes = await readFile(target);
  assert.equal(bytes.toString(), `${text.trimEnd()}\n`);
  await chmod(target, 0o444);
  evidence.push(record(name, bytes));
  return { root: reportRoot, ...record(name, bytes) };
}

async function rawFile(path, bytes, mode = 0o444) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  await chmod(path, mode);
  return record(path, bytes, { mode });
}

async function stableRead(filename) {
  const stat = await lstat(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `regular file required: ${filename}`);
  assert.ok(stat.size <= 128 * 1024 * 1024, 'file hash cap');
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const current = await lstat(filename);
    hashedBytes += bytes.length;
    assert.ok(hashedBytes <= 2 * 1024 * 1024 * 1024, 'freeze hash budget');
    assert.equal(bytes.length, before.size);
    for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(before[key], after[key], `changed during read: ${filename}`);
    assert.equal(stat.ino, current.ino); assert.equal(stat.dev, current.dev);
    return { ...record(filename, bytes), bytes, stat: after };
  } finally { await handle.close(); }
}

async function members(root) {
  const files = [];
  let count = 0;
  async function visit(directory, depth) {
    assert.ok(depth <= 32 && ++count <= 16384, 'membership cap');
    for (const name of (await readdir(directory)).sort()) {
      const filename = join(directory, name), stat = await lstat(filename);
      assert.ok(!stat.isSymbolicLink(), `link forbidden: ${filename}`);
      if (stat.isDirectory()) await visit(filename, depth + 1);
      else { assert.ok(stat.isFile(), `special file forbidden: ${filename}`); files.push(relative(root, filename)); }
    }
  }
  await visit(root, 0);
  return files.sort();
}

function groupGone(pid) {
  try { process.kill(-pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}

async function command(label, executable, args, cwd, env, timeoutMs = 60000, outputCap = 4 * 1024 * 1024) {
  const result = { label, executable, args, cwd, env, timeoutMs, combinedOutputCap: outputCap, productImportsAuthorized: false, startedAt: new Date().toISOString(), cleanupSignals: [] };
  processes.push(result);
  const stdout = [], stderr = [];
  let total = 0;
  await new Promise(resolveClose => {
    const child = spawn(executable, args, { cwd, env, detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = reason => {
      result.failure ??= reason;
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); result.cleanupSignals.push(reason); } catch (error) { if (error.code !== 'ESRCH') result.cleanupError = error.code; }
    };
    const timer = setTimeout(() => kill('DEADLINE'), timeoutMs);
    child.on('spawn', () => { result.pid = child.pid; });
    child.on('error', error => { result.failure = error.message; });
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', chunk => {
      total += chunk.length;
      if (total > outputCap) kill('OUTPUT_CAP'); else chunks.push(Buffer.from(chunk));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer); result.exitCode = code; result.signal = signal; result.closed = true;
      result.groupGone = child.pid ? groupGone(child.pid) : true;
      if (!result.groupGone) { kill('RESIDUAL_PROCESS_GROUP'); result.groupGone = groupGone(child.pid); }
      resolveClose();
    });
  });
  result.finishedAt = new Date().toISOString(); result.outputBytes = total;
  const output = Buffer.concat(stdout), errors = Buffer.concat(stderr);
  result.stdoutBase64 = output.toString('base64'); result.stderrBase64 = errors.toString('base64');
  result.displayTextLogsNormalizeFinalNewline = true;
  result.stdout = await publish(`processes/${label}.stdout.txt`, output.toString());
  result.stderr = await publish(`processes/${label}.stderr.txt`, errors.toString());
  result.stdoutRawSha256 = digest(output); result.stderrRawSha256 = digest(errors);
  await publish(`processes/${label}.json`, result);
  assert.ok(result.closed && result.groupGone && result.exitCode === 0 && !result.failure, `tool failed: ${label}`);
  return output;
}

async function verifyFiles(root, expected, modes = true) {
  assert.deepEqual(await members(root), expected.map(entry => entry.path).sort(), `membership: ${root}`);
  const files = [];
  for (const entry of expected) {
    const actual = await stableRead(join(root, entry.path));
    assert.equal(actual.sha256, entry.sha256, `hash: ${actual.path}`);
    assert.equal(actual.bytes.length, entry.bytes, `size: ${actual.path}`);
    assert.equal(actual.stat.nlink, 1, 'independent regular copy required');
    if (modes && entry.mode !== undefined) assert.equal(actual.stat.mode & 0o777, entry.mode);
    files.push({ path: entry.path, bytes: actual.bytes.length, sha256: actual.sha256, mode: actual.stat.mode & 0o777 });
  }
  return files;
}

try {
  assert.equal(gitRead(['rev-parse', '--verify', `${candidate}^{commit}`]).toString().trim(), candidate);
  assert.equal(gitRead(['rev-parse', `${candidate}^{tree}`]).toString().trim(), candidateTree);
  const ancestry = requiredAncestors.map(short => {
    const full = gitRead(['rev-parse', '--verify', `${short}^{commit}`]).toString().trim();
    gitRead(['merge-base', '--is-ancestor', full, candidate]);
    return { short, full, ancestor: true };
  });
  scratch = await realpath(await mkdtemp('/tmp/safe-bash-measurement-freeze-'));
  const paths = { scratch, artifacts: join(scratch, 'artifacts'), tools: join(scratch, 'tools'), build: join(scratch, 'build', 'source'), runtime: join(scratch, 'runtime'), offlineCandidate: join(scratch, 'offline', 'virtual-bash'), offlineBaseline: join(scratch, 'offline', 'just-bash'), host: join(scratch, 'host') };
  for (const directory of [paths.artifacts, paths.tools, dirname(paths.build), paths.runtime, paths.offlineCandidate, paths.offlineBaseline, join(paths.host, 'cwd'), join(paths.host, 'home'), join(paths.host, 'tmp')]) await mkdir(directory, { recursive: true, mode: 0o700 });
  await publish('location.json', { candidate, candidateTree, paths, ancestry, scope: 'COMPARISON_ONLY; STOP_BEFORE_PRODUCT_IMPORTS' });
  phase = 'primary-authentication-copy';
  const primaryRecords = {};
  for (const name of ['download.json', 'registry-metadata.raw.json', 'published-files.json', 'execution-closure.json', 'execution-post-run-check-attempt-1.json', 'lock-graph-check.json', 'extract.py']) {
    const bytes = gitFile(primary, `${authentication}/${name}`);
    primaryRecords[name] = { ...record(`${authentication}/${name}`, bytes), commit: primary };
    await rawFile(join(paths.tools, 'primary', name), bytes);
  }
  const download = json(await readFile(join(paths.tools, 'primary/download.json')));
  const registryBytes = await readFile(join(paths.tools, 'primary/registry-metadata.raw.json'));
  const registry = json(registryBytes);
  const published = json(await readFile(join(paths.tools, 'primary/published-files.json')));
  const closureRecord = json(await readFile(join(paths.tools, 'primary/execution-post-run-check-attempt-1.json')));
  assert.equal(digest(registryBytes), download.officialMetadata.sha256);
  assert.equal(registry.name, 'just-bash'); assert.equal(registry.version, '3.4.2');
  const tar = await stableRead(download.officialTarball.path);
  assert.equal(tar.sha256, 'f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d');
  assert.equal(digest(tar.bytes, 'sha1'), 'abc0520ad5c278eae2de4cd90c3d7f88e1fdd724');
  assert.equal(`sha512-${digest(tar.bytes, 'sha512', 'base64')}`, registry.dist.integrity);
  const tarPath = join(paths.artifacts, 'just-bash-3.4.2.tgz');
  await rawFile(tarPath, tar.bytes);
  const packageMap = new Map(published.files.map(entry => [entry.path, entry]));
  assert.equal(packageMap.size, 955);
  assert.equal(closureRecord.actualFiles.length, 3844);
  assert.deepEqual(await members(closureRecord.integrity.root), closureRecord.actualFiles.map(entry => entry.path).sort());
  const baselineSourceFiles = [];
  const publicationMatches = [];
  for (const expected of closureRecord.actualFiles) {
    const actual = await stableRead(join(closureRecord.integrity.root, expected.path));
    assert.equal(actual.sha256, expected.sha256); assert.equal(actual.bytes.length, expected.bytes);
    assert.equal(actual.stat.mode & 0o777, expected.mode); assert.equal(actual.stat.nlink, 1);
    if (expected.path.startsWith('benchmarks/node_modules/just-bash/')) {
      const relativeName = expected.path.slice('benchmarks/node_modules/just-bash/'.length);
      const member = packageMap.get(relativeName);
      assert.ok(member, `unpublished package file: ${relativeName}`);
      assert.equal(actual.sha256, member.sha256); assert.equal(actual.bytes.length, member.bytes);
      publicationMatches.push({ path: relativeName, bytes: member.bytes, sha256: actual.sha256 });
    }
    await rawFile(join(paths.offlineBaseline, expected.path), actual.bytes, expected.mode);
    baselineSourceFiles.push({ path: expected.path, bytes: expected.bytes, sha256: expected.sha256, mode: expected.mode });
  }
  assert.equal(publicationMatches.length, 955);
  const baselineFiles = await verifyFiles(paths.offlineBaseline, baselineSourceFiles);
  const movedTar = await stableRead(tarPath); assert.equal(movedTar.sha256, tar.sha256);
  await publish('baseline-authentication.json', {
    primaryCommit: primary, primaryRecords, sourceRoot: closureRecord.integrity.root, movedRoot: paths.offlineBaseline,
    tar: { root: paths.artifacts, ...record('just-bash-3.4.2.tgz', tar.bytes), sha1: digest(tar.bytes, 'sha1'), sri: registry.dist.integrity, movedBytesVerified: true },
    package: { name: 'just-bash', version: '3.4.2', files: publicationMatches, count: 955, allSourceAndMovedBytesMatchPrimary: true },
    old3842Profile: { exactMembershipFailed: true, unchangedFailure: true, additionalFiles: ['auth-observer/observe-load.mjs', 'auth-observer/observe-process.mjs'] },
    selected3844Profile: { exactMembershipAndBytesMatch: true, files: baselineFiles.length, separateProfileNotSilentRepair: true },
    freshNetwork: false, productImports: 0, dependencyBoundary: 'Only just-bash package publication authenticated. Other dependency/tool/worker assets are frozen hash/lock identities, not individual publisher or runtime evaluation proof.',
  });
  await publish('baseline-closure.json', { root: paths.offlineBaseline, files: baselineFiles });
  phase = 'git-source-and-tools';
  const sourceArchive = join(paths.artifacts, 'candidate-source.tar.gz');
  gitRead(['archive', '--format=tar.gz', '--prefix=package/', `--output=${sourceArchive}`, candidate, '--', ...sourceSelections]);
  await chmod(sourceArchive, 0o444);
  const treeEntries = gitRead(['ls-tree', '-r', '-z', candidate, '--', ...sourceSelections]).toString().split('\0').filter(Boolean).map(line => {
    const [header, path] = line.split('\t'), [mode, type, object] = header.split(' ');
    assert.equal(type, 'blob'); assert.ok(['100644', '100755'].includes(mode), 'source links or special Git entries forbidden');
    return { path, gitMode: mode, gitBlob: object };
  });
  const nodeSource = await stableRead(download.executable);
  assert.equal(nodeSource.sha256, download.nodeSha256);
  const node = join(paths.tools, 'node'); await rawFile(node, nodeSource.bytes, 0o555);
  const pythonSource = await stableRead('/usr/bin/python3');
  for (const name of ['archive-tools.py', 'resolve-public.mjs', 'preflight-only-loader.mjs']) await rawFile(join(paths.tools, name), await readFile(join(reportRoot, name)));
  const environment = { PATH: '/usr/bin:/bin', HOME: join(paths.host, 'home'), TMPDIR: join(paths.host, 'tmp'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
  const extraction = json(await command('source-extract', '/usr/bin/python3', ['-I', '-B', join(paths.tools, 'archive-tools.py'), 'extract', sourceArchive, paths.build, join(paths.tools, 'primary/extract.py')], scratch, environment));
  assert.deepEqual(extraction.files.map(entry => entry.path).sort(), treeEntries.map(entry => entry.path).sort());
  const sourceFiles = [];
  for (const entry of treeEntries) {
    const actual = await stableRead(join(paths.build, entry.path));
    assert.equal(digest(Buffer.concat([Buffer.from(`blob ${actual.bytes.length}\0`), actual.bytes]), 'sha1'), entry.gitBlob);
    const sourceMode = parseInt(entry.gitMode.slice(-3), 8);
    await chmod(actual.path, sourceMode & ~0o222);
    sourceFiles.push({ ...entry, bytes: actual.bytes.length, sha256: actual.sha256, extractedMode: actual.stat.mode & 0o777, sealedMode: sourceMode & ~0o222 });
  }
  const sourceArchiveIdentity = await stableRead(sourceArchive);
  const packageJson = json(await readFile(join(paths.build, 'package.json')));
  const lockBytes = await readFile(join(paths.build, 'package-lock.json'));
  const lock = json(lockBytes);
  assert.equal(packageJson.scripts.build, 'tsc -p tsconfig.build.json');
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.deepEqual(packageJson.files, ['dist']);
  const frozenLock = await readFile(join(paths.offlineBaseline, 'package-lock.json'));
  assert.equal(digest(lockBytes), digest(frozenLock));
  for (const member of baselineFiles.filter(entry => entry.path.startsWith('node_modules/'))) {
    const copied = await readFile(join(paths.offlineBaseline, member.path));
    assert.equal(digest(copied), member.sha256);
    await rawFile(join(paths.build, member.path), copied, member.mode);
  }
  const compilerFiles = await verifyFiles(join(paths.build, 'node_modules'), baselineFiles.filter(entry => entry.path.startsWith('node_modules/')).map(entry => ({ ...entry, path: entry.path.slice('node_modules/'.length) })));
  const compilerPackage = json(await readFile(join(paths.build, 'node_modules/typescript/package.json')));
  assert.equal(compilerPackage.version, lock.packages['node_modules/typescript'].version);
  const sourceInventory = await publish('source-inventory.json', { candidate, gitTree: candidateTree, selections: sourceSelections, fullRepositoryTestInventoryClaim: false, files: sourceFiles, archive: { root: paths.artifacts, ...record('candidate-source.tar.gz', sourceArchiveIdentity.bytes) }, sourceFromGitOnly: true, trackedDirtyWorktreeConsumed: false });
  await publish('compiler-closure.json', { root: join(paths.build, 'node_modules'), files: compilerFiles, lockSha256: digest(lockBytes), packageVersion: compilerPackage.version, publicationAuthenticated: false, boundary: 'Existing primary locked development tree; candidate lock byte-equal, no installation.' });
  await publish('build-inputs.json', { candidate, node: record(node, nodeSource.bytes), nodeSource: download.executable, python: record('/usr/bin/python3', pythonSource.bytes), buildScript: packageJson.scripts.build, compilerEntry: compilerFiles.find(entry => entry.path === 'typescript/bin/tsc'), compilerImplementation: compilerFiles.find(entry => entry.path === 'typescript/lib/_tsc.js'), sourceInventory, noLifecycleHooks: true, noProductImports: true });
  phase = 'compiler-build-and-package';
  await command('compiler-build', node, ['--max-old-space-size=512', join(paths.build, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], paths.build, environment, 180000);
  for (const expected of sourceFiles) { const actual = await stableRead(join(paths.build, expected.path)); assert.equal(actual.sha256, expected.sha256); }
  const packageArchive = join(paths.artifacts, `virtual-bash-${packageJson.version}.tgz`);
  const packed = json(await command('package-archive', '/usr/bin/python3', ['-I', '-B', join(paths.tools, 'archive-tools.py'), 'pack', paths.build, packageArchive], scratch, environment));
  await chmod(packageArchive, 0o444);
  const stage = join(scratch, 'unpacked-public-package');
  const unpacked = json(await command('package-extract', '/usr/bin/python3', ['-I', '-B', join(paths.tools, 'archive-tools.py'), 'extract', packageArchive, stage, join(paths.tools, 'primary/extract.py')], scratch, environment));
  const contentMap = rows => rows.map(entry => ({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 })).sort((first, second) => first.path.localeCompare(second.path));
  assert.deepEqual(contentMap(packed.files), contentMap(unpacked.files));
  await mkdir(join(paths.offlineCandidate, 'node_modules'), { mode: 0o700 });
  const candidatePackage = join(paths.offlineCandidate, 'node_modules/virtual-bash');
  await rename(stage, candidatePackage);
  for (const entry of packed.files) {
    const filename = join(candidatePackage, entry.path); await chmod(filename, 0o444);
    const built = await lstat(join(paths.build, entry.path)), moved = await lstat(filename);
    assert.notEqual(`${built.dev}:${built.ino}`, `${moved.dev}:${moved.ino}`);
  }
  await rawFile(join(paths.offlineCandidate, 'package-lock.json'), lockBytes);
  const candidateFiles = await verifyFiles(paths.offlineCandidate, [...packed.files.map(entry => ({ path: `node_modules/virtual-bash/${entry.path}`, bytes: entry.bytes, sha256: entry.sha256, mode: 0o444 })), { path: 'package-lock.json', bytes: lockBytes.length, sha256: digest(lockBytes), mode: 0o444 }]);
  const packIdentity = await stableRead(packageArchive);
  await publish('candidate-package.json', { candidate, buildRoot: paths.build, archive: { root: paths.artifacts, ...record(relative(paths.artifacts, packageArchive), packIdentity.bytes) }, archiveMethod: packed.method, archiveFiles: packed.files, guardedExtractor: primaryRecords['extract.py'], independentUnpackManifest: unpacked, movedRoot: candidatePackage, movedFromNowAbsent: stage, sourceWorkspaceAliases: false, symlinks: false, sourcePackageFileInodesDistinct: true, packageName: packageJson.name, version: packageJson.version, runtimeDependencies: {}, claims: 'Real built offline public archive and moved regular consumer bytes; not runtime or independent packed review acceptance.' });
  await publish('candidate-closure.json', { root: paths.offlineCandidate, files: candidateFiles });
  phase = 'frozen-runner-and-binding';
  const runnerRoot = join(paths.runtime, 'execution'), cohortRoot = join(paths.runtime, 'cohorts');
  const reviewedBytes = gitFile(candidate, `${prefix}/execution-review/FINAL_RECEIPT.json`);
  const reviewed = json(reviewedBytes);
  assert.equal(reviewed.decision, 'GO_BRIDGE_ONLY');
  assert.deepEqual(reviewed.runtime.files.map(entry => entry.path).sort(), [...runtimeNames].sort());
  const runnerFiles = [];
  for (const name of runtimeNames) {
    const bytes = gitFile(candidate, `${prefix}/execution/${name}`);
    const accepted = reviewed.runtime.files.find(entry => entry.path === name);
    assert.equal(bytes.length, accepted.bytes); assert.equal(digest(bytes), accepted.sha256);
    await rawFile(join(runnerRoot, name), bytes);
    runnerFiles.push(record(name, bytes));
  }
  const seals = {};
  const cohortFiles = new Map();
  for (const name of ['SEAL.json', 'AMENDMENT_V2_SEAL.json']) {
    const bytes = gitFile(candidate, `${prefix}/cohorts/${name}`);
    seals[name] = digest(bytes); cohortFiles.set(name, record(name, bytes));
    await rawFile(join(cohortRoot, name), bytes);
    for (const expected of json(bytes).files) {
      if (cohortFiles.has(expected.path)) { assert.equal(cohortFiles.get(expected.path).sha256, expected.sha256); continue; }
      const payload = gitFile(candidate, `${prefix}/cohorts/${expected.path}`);
      assert.equal(payload.length, expected.bytes); assert.equal(digest(payload), expected.sha256);
      await rawFile(join(cohortRoot, expected.path), payload); cohortFiles.set(expected.path, record(expected.path, payload));
    }
  }
  assert.equal(seals['SEAL.json'], 'da99ce71943feec45a2bbbae6319e38fb1816522b5ffddbe55ae28b0716ce230');
  assert.equal(seals['AMENDMENT_V2_SEAL.json'], '839d12181a024a6dcab928a5f1483ac3a9e10af8d04ab4bb9454dae02427e186');
  const baselineManifest = json(gitFile(candidate, 'benchmarks/reports/baseline-only-20260827/coverage-execution/attempt-002/manifest.json'));
  const baselineAssets = [...baselineManifest.runtimeAssets.map(entry => entry.path), ...baselineManifest.resolvedDependencies.map(entry => relative(repository, entry.path))];
  assert.equal(baselineAssets.length, 29);
  for (const name of baselineAssets) assert.ok(baselineFiles.some(entry => entry.path === name));
  const nodeMoved = await stableRead(node); assert.equal(nodeMoved.sha256, nodeSource.sha256);
  const qualifications = {
    scope: 'COMMITTED_FROZEN_COMPARISON_ONLY', qualificationAcceptedMeaning: 'Latest explicit ROOT comparison authorization only; never release or whole-gate approval.',
    releaseQualified: false, globalGreen: false, wholeGateApproval: false, rootWholeGateCleanupPrerequisite: false,
    envSplitS: 'PARTIAL', shebang: 'UNSUPPORTED', independentFixtureValidity: 'UNRESOLVED',
    independentFreezeCheck: 'PENDING; this leaf stops for independent verification', priorIndependentPackedReviewClaim: false,
    rootAnnouncementRequiredBeforeProductImports: true, timingAuthorized: false, nativeRecaptureAuthorized: false,
  };
  const binding = {
    schema: 'safe-bash.execution-binding.v1', preparationCommit: '2b2a5fe48142dd94238d37ec77dfd736e2117e71', seals, profiles: ['original', 'aligned', 'breadth'],
    candidate: { commit: candidate, gitTree: candidateTree, sourceSha256: sourceArchiveIdentity.sha256, source: { root: paths.artifacts, ...record('candidate-source.tar.gz', sourceArchiveIdentity.bytes) }, sourceInventory, packSha256: packIdentity.sha256, pack: { root: paths.artifacts, ...record(relative(paths.artifacts, packageArchive), packIdentity.bytes) } },
    node: { root: paths.tools, ...record('node', nodeMoved.bytes) }, runner: { root: runnerRoot, files: runnerFiles },
    engines: {
      'virtual-bash': { closure: { root: paths.offlineCandidate, files: candidateFiles }, packageJson: 'node_modules/virtual-bash/package.json', entry: 'node_modules/virtual-bash/dist/index.js', assets: [], locks: ['package-lock.json'], heapMiB: 256 },
      'just-bash': { closure: { root: paths.offlineBaseline, files: baselineFiles }, packageJson: 'benchmarks/node_modules/just-bash/package.json', entry: 'benchmarks/node_modules/just-bash/dist/bundle/index.js', assets: baselineAssets, locks: ['package-lock.json', 'benchmarks/package-lock.json', 'node_modules/.package-lock.json', 'benchmarks/node_modules/.package-lock.json'], heapMiB: 256 },
    },
    baselineTar: { root: paths.artifacts, ...record('just-bash-3.4.2.tgz', movedTar.bytes) }, host: { root: paths.host, cwd: join(paths.host, 'cwd'), env: environment }, qualifications,
    cohortClosure: { root: cohortRoot, files: [...cohortFiles.values()] },
    heapPolicy: { expandedMiB: 256, breadthMiB: { 'virtual-bash': 256, 'just-bash': 256 }, status: 'Explicit prospective binding policy for ROOT announcement, not a historical breadth limit or symmetric RSS guarantee.' },
    packaging: { archiveMethod: packed.method, unpackAndMoveManifest: evidence.find(entry => entry.path === 'candidate-package.json') },
    authorizationSource: { authority: 'ROOT', instruction: 'ROOT AUTHORIZES committedcandidate e33974b8 MEASURE; freeze and static PREFLIGHT only in this leaf; ROOT announces exact hashes before imports.', scopeOwner: 'measurement-freeze/** plus isolated tmp', noNewUserReapprovalRequested: true },
  };
  const bindingArtifact = await publish('execution-binding.json', binding);
  const receipt = { authority: 'ROOT', purpose: 'MEASURE_HISTORICAL', bindingSha256: bindingArtifact.sha256, candidateCommit: candidate, executionAuthorized: true, timingAuthorized: false, qualificationAccepted: true, qualificationScope: qualifications.scope, qualificationAcceptedMeaning: qualifications.qualificationAcceptedMeaning, qualifications, status: 'PROPOSED_ROOT_COORDINATION_RECEIPT_FOR_HASH_ANNOUNCEMENT; not permission for this leaf to import engines', exactSourceSha256: sourceArchiveIdentity.sha256, exactPackageSha256: packIdentity.sha256, requiredProfiles: binding.profiles };
  const receiptArtifact = await publish('proposed-root-receipt.json', receipt);
  await publish('runner-cohort-bindings.json', { candidate, runner: binding.runner, cohorts: binding.cohortClosure, seals, independentBridgeReview: record(`${prefix}/execution-review/FINAL_RECEIPT.json`, reviewedBytes), all15ReviewedRuntimeHashesMatch: true, bridgeUnchanged: true, sourceReadFromGitOnly: true, noRelativePathBreak: true, staticEntryGraph: staticNames });
  const resolutionTargets = Object.entries(binding.engines).map(([name, engine]) => ({ name, packageJson: join(engine.closure.root, engine.packageJson), entry: join(engine.closure.root, engine.entry) }));
  const resolutionPath = join(paths.tools, 'resolution-targets.json');
  await rawFile(resolutionPath, Buffer.from(JSON.stringify(resolutionTargets)));
  const resolution = json(await command('public-resolution-only', node, ['--experimental-import-meta-resolve', join(paths.tools, 'resolve-public.mjs'), resolutionPath], paths.host, environment));
  await publish('public-resolution.json', resolution);
  phase = 'static-preflight';
  const allowlist = { files: Object.fromEntries(runnerFiles.filter(entry => staticNames.includes(entry.path)).map(entry => [join(runnerRoot, entry.path), { bytes: entry.bytes, sha256: entry.sha256 }])), log: join(scratch, 'static-preflight-loads.jsonl') };
  await rawFile(join(paths.tools, 'preflight-allowlist.json'), Buffer.from(JSON.stringify(allowlist)));
  const preflightArgs = ['--experimental-loader', join(paths.tools, 'preflight-only-loader.mjs'), join(runnerRoot, 'run.mjs'), 'PREFLIGHT', '--binding', join(reportRoot, 'execution-binding.json'), '--root-receipt', join(reportRoot, 'proposed-root-receipt.json'), '--root-receipt-sha256', receiptArtifact.sha256];
  const preflight = json(await command('static-preflight', node, preflightArgs, paths.host, environment, 180000));
  assert.equal(preflight.status, 'BOUND_NOT_MEASURED'); assert.equal(preflight.productImports, 0);
  const loadBytes = await readFile(allowlist.log);
  const loads = loadBytes.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.ok(loads.length > 0 && loads.every(entry => allowlist.files[entry.path]));
  await publish('static-preflight.json', { ...preflight, loadEvents: loads, denyUnlistedProductModules: true, loadHookBoundary: 'Returned preflight helper source bytes only; product paths not admitted. No engine child, module or native oracle was invoked.', command: { executable: node, args: preflightArgs, cwd: paths.host, env: environment } });
  const tools = [];
  for (const name of ['node', 'archive-tools.py', 'resolve-public.mjs', 'preflight-only-loader.mjs', 'preflight-allowlist.json', 'primary/extract.py']) {
    const bytes = await readFile(join(paths.tools, name)); tools.push(record(name, bytes));
  }
  await publish('tool-bindings.json', { root: paths.tools, files: tools, python: record('/usr/bin/python3', pythonSource.bytes), nodeDynamicSystemLibrariesIndividuallyAuthenticated: false });
  await publish('git-reads.json', { candidate, ancestry, reads: gitReads, worktreeProductBytesConsumed: 0 });
  const measureOutput = join(scratch, 'measurement-attempt-001');
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const measureArgs = [node, join(runnerRoot, 'run.mjs'), 'MEASURE', '--binding', join(reportRoot, 'execution-binding.json'), '--root-receipt', join(reportRoot, 'proposed-root-receipt.json'), '--root-receipt-sha256', receiptArtifact.sha256, '--output', measureOutput];
  const commandLine = ['/usr/bin/env', '-i', ...Object.entries(environment).map(([key, value]) => quote(`${key}=${value}`)), ...measureArgs.map(quote)].join(' ');
  await publish('NEXT_COMMAND.txt', `ROOT MUST ANNOUNCE EXACT HASHES AND COMPLETE INDEPENDENT FREEZE CHECK FIRST. THIS LEAF MUST NOT RUN THIS COMMAND.\n${commandLine}\n`);
  await publish('READY.json', { status: 'STATIC_PREFLIGHT_READY_FOR_INDEPENDENT_FREEZE_CHECK_NOT_MEASURED', candidate, gitTree: candidateTree, sourceSha256: sourceArchiveIdentity.sha256, sourceInventorySha256: sourceInventory.sha256, packageSha256: packIdentity.sha256, binding: bindingArtifact, proposedRootReceipt: receiptArtifact, nodeSha256: nodeMoved.sha256, paths, profiles: binding.profiles, qualifications, productImports: 0, engineCalls: 0, freshNativeOracleCalls: 0, measurementCalls: 0, timingTrials: 0, downloads: 0, installs: 0, staging: false, commits: false, processCounts: { launched: processes.length, closed: processes.filter(entry => entry.closed).length, groupsGone: processes.filter(entry => entry.groupGone).length, failures: processes.filter(entry => entry.failure || entry.exitCode !== 0).length }, hashedBytes, requiredCommandFile: 'NEXT_COMMAND.txt', outputDirectoryMustNotExist: measureOutput });
  const manifest = { candidate, gitTree: candidateTree, files: [...evidence], authoredScripts: await Promise.all(['prepare-freeze.mjs', 'archive-tools.py', 'resolve-public.mjs', 'preflight-only-loader.mjs', 'AUTHORIZATION.md'].map(async name => record(name, await readFile(join(reportRoot, name))))), selfExcluded: true, productImports: 0, measurementExecuted: false };
  await publish('FREEZE_MANIFEST.json', manifest);
  console.log(JSON.stringify({ status: 'READY_FOR_INDEPENDENT_FREEZE_CHECK', candidate, sourceSha256: sourceArchiveIdentity.sha256, packageSha256: packIdentity.sha256, bindingSha256: bindingArtifact.sha256, receiptSha256: receiptArtifact.sha256, ready: join(reportRoot, 'READY.json'), scratch, productImports: 0 }, null, 2));
} catch (error) {
  const failure = { phase, candidate, scratch: scratch ?? null, error: error.stack ?? String(error), processes, hashedBytes, productImports: 0, measurementExecuted: false, noRetryAuthorizedByFailure: true };
  await publish(`FAILURE-${Date.now()}.json`, failure);
  console.error(JSON.stringify({ status: 'STOPPED_FREEZE_FAILURE', phase, error: error.message, scratch, productImports: 0 }));
  process.exitCode = 1;
}

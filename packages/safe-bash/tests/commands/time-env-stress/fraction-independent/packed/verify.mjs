import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../../..');
assert.equal(repo, '/Users/kjopek/Workspace/safe-bash');
assert.equal(process.versions.node.split('.')[0], '22');
const source = 'c7823633ee99f711f1319ace59d4cf2b7f622ecc';
const evidenceRevision = '4a0cbe7a8e01bfe15db757f76b1cd30c283fe792';
const originalSource = 'd904ca986fa945df8aef6e11b4165e2c2a63f814';
const output = resolve(process.argv[2] ?? join(own, 'evidence'));
assert.ok(output.startsWith(own + '/') || output.startsWith('/tmp/'));
await mkdir(output);
const scratch = await mkdtemp('/tmp/safe-bash-fraction-independent-packed-');
const build = join(scratch, 'archive');
const consumer = join(scratch, 'consumer');
const installed = join(consumer, 'node_modules/virtual-bash');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: repo, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
const pinned = (revision, path) => git(['show', `${revision}:${path}`]);
const save = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
};
async function fileHash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
async function hashes(directory, prefix = '') {
  const result = {};
  for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(directory, path));
    else if (entry.isSymbolicLink()) result[path] = { symlink: await readlink(join(directory, path)) };
    else { assert.ok(entry.isFile(), path); result[path] = await fileHash(join(directory, path)); }
  }
  return result;
}
const report = { identity: '01a0426e-f309-7682-bfbf-2cd25393acf3 NEW independent packed/cohort verifier; no delegation',
  source, sourceAncestor: git(['rev-parse', 'f6406cd']).toString().trim(), evidenceRevision,
  startedAt: new Date().toISOString(), scratch, versions: process.versions, platform: process.platform, architecture: process.arch,
  movingHeadBefore: git(['rev-parse', 'HEAD']).toString().trim(), worktreeBefore: git(['status', '--short']).toString(),
  stagedBefore: git(['diff', '--cached', '--raw']).toString(), commands: {}, fixtures: {}, adaptations: [], limitations: [
    'time-env has no root or export-map subpath export: no public time-env factory/type acceptance',
    'source-import original223/existing83/new54 are unchanged source-archive replay, not packed/public runs',
    'packed304 and packed305 use exported root APIs plus the real packed INTERNAL time-env leaf',
    'original per-row captures omit bytes in some assertion-only controls; raw runner bytes are retained, not invented',
    'GNU9.7 built on Darwin and Apple are distinct profiles, not GNU/Linux or universal parity',
    'no separate source semantics acceptance; no canonical assertion migrations',
  ] };
const environment = { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: join(scratch, 'tmp'), LC_ALL: 'C', LANG: 'C', TZ: 'Pacific/Honolulu',
  TSX_DISABLE_CACHE: '1', REVIEW_OUTPUT: output, GNU_DIR: join(build, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src'), PACKED_ROOT: installed };
await mkdir(build); await mkdir(environment.TMPDIR);
const supervisorBytes = pinned(evidenceRevision, 'tests/integration/full-gate-20260827/supervise.mjs');
report.supervisorSha256 = hash(supervisorBytes);
await save(join(scratch, 'supervise.mjs'), supervisorBytes);
const { supervise } = await import(pathToFileURL(join(scratch, 'supervise.mjs')).href);
async function execute(label, args, cwd = build, extraEnv = {}, executable = process.execPath) {
  const stdoutPath = join(output, label + '.stdout'), stderrPath = join(output, label + '.stderr');
  const result = await supervise(executable, args, { cwd, env: { ...environment, ...extraEnv }, stdout: stdoutPath, stderr: stderrPath,
    timeoutMs: 120000, maxOutputBytes: 16 * 1024 * 1024 });
  const stdout = await readFile(stdoutPath), stderr = await readFile(stderrPath);
  result.stdout = { bytes: stdout.length, sha256: hash(stdout) }; result.stderr = { bytes: stderr.length, sha256: hash(stderr) };
  result.counts = Object.fromEntries([...stdout.toString().matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  report.commands[label] = result;
  await save(join(output, label + '.json'), result);
  console.log(label, result.status, JSON.stringify(result.counts));
  assert.equal(result.clean, true, JSON.stringify(result));
  return result.status;
}
async function fixture(revision, path, target) {
  const original = pinned(revision, path);
  report.fixtures[`${revision}:${path}`] = { sha256: hash(original), bytes: original.length, destination: target };
  if (target) await save(target, original);
  return original;
}
function adapt(original, replacements, label) {
  let text = original.toString();
  for (const [before, after, expectedCount] of replacements) {
    assert.equal(text.split(before).length - 1, expectedCount, `${label}: ${before}`);
    text = text.replaceAll(before, after);
  }
  report.adaptations.push({ label, originalSha256: hash(original), adaptedSha256: hash(text), replacements });
  return text;
}
async function negativeTypes(label, name, expectedCodes, typeArguments) {
  assert.equal(await execute(label, [...typeArguments, '--noEmit', name], consumer), 2);
  const diagnostic = await readFile(join(output, label + '.stdout'), 'utf8');
  const codes = [...diagnostic.matchAll(/error TS(\d+)/g)].map(match => Number(match[1])).sort();
  assert.deepEqual(codes, expectedCodes.slice().sort());
  assert.ok(!/TS2307|Cannot find module|Cannot find type definition|TS6053|TS5083/.test(diagnostic));
  report.commands[label].desiredDiagnosticCodes = codes;
}
try {
  assert.equal(git(['rev-parse', '--show-toplevel']).toString().trim(), repo);
  git(['merge-base', '--is-ancestor', report.sourceAncestor, source]);
  report.node = { executable: process.execPath, sha256: await fileHash(process.execPath) };
  report.gitTree = git(['rev-parse', `${source}^{tree}`]).toString().trim();
  const archivePath = join(scratch, 'full-committed-source.tar');
  assert.equal(await execute('git-archive', ['archive', '--format=tar', '--output', archivePath, source], repo, {}, '/usr/bin/git'), 0);
  report.archive = { sha256: await fileHash(archivePath), bytes: (await lstat(archivePath)).size, fullCommitNoPathFilter: true };
  assert.equal(await execute('extract-source', ['-xf', archivePath, '-C', build], scratch, {}, '/usr/bin/tar'), 0);
  const tracked = git(['ls-tree', '-rz', source]).toString().split('\0').filter(Boolean).map(entry => entry.split('\t')[1]);
  async function trackedDigest() {
    const digest = createHash('sha256');
    for (const path of tracked) {
      const metadata = await lstat(join(build, path));
      digest.update(path + '\0' + (metadata.isSymbolicLink() ? `symlink:${await readlink(join(build, path))}` : await fileHash(join(build, path))) + '\n');
    }
    return digest.digest('hex');
  }
  report.trackedArchive = { files: tracked.length, orderedPathAndHashSha256: await trackedDigest() };
  report.sourceFiles = await hashes(join(build, 'src'));
  report.originalConfigs = {};
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']) {
    report.originalConfigs[path] = await fileHash(join(build, path));
    assert.equal(report.originalConfigs[path], hash(pinned(source, path)));
    await save(join(output, 'inputs', path + '.txt'), await readFile(join(build, path)));
  }
  assert.equal(report.originalConfigs['package-lock.json'], await fileHash(join(repo, 'package-lock.json')));
  await cp(join(repo, 'node_modules'), join(build, 'node_modules'), { recursive: true, dereference: true });
  const toolsBefore = await hashes(join(build, 'node_modules'));
  report.compiler = { version: JSON.parse(await readFile(join(build, 'node_modules/typescript/package.json'))).version,
    sha256: await fileHash(join(build, 'node_modules/typescript/lib/_tsc.js')), dependenciesDigest: hash(JSON.stringify(toolsBefore)),
    reuse: 'regular dereferenced copy of cached dev tools; no product runtime dependency symlink' };
  report.native = {};
  for (const name of ['date', 'sleep', 'printenv']) {
    const path = join(environment.GNU_DIR, name); await mkdir(dirname(path), { recursive: true });
    await cp(join(repo, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src', name), path, { dereference: true });
    report.native[name] = { sha256: await fileHash(path) };
    assert.equal(await execute(`native-version-${name}`, ['--version'], scratch, {}, path), 0);
    report.native[name].version = await readFile(join(output, `native-version-${name}.stdout`), 'utf8');
    assert.match(report.native[name].version, /GNU coreutils\) 9\.7/);
  }
  assert.equal(report.native.date.sha256, '14c1c04f8a1e859e9421993856ba1d29f49dc750d91be5dd299841f970f31f44');
  for (const path of ['/bin/date', '/bin/sleep', '/usr/bin/printenv']) report.native[path] = { sha256: await fileHash(path), profile: 'Apple/Darwin, not GNU expected output' };
  const primaryArchive = join(repo, 'tests/commands/metadata-stress/.oracle/coreutils-9.7.tar.xz');
  report.nativeArchiveSha256 = await fileHash(primaryArchive);
  assert.equal(report.nativeArchiveSha256, 'e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf');
  report.primarySource = {};
  for (const path of ['src/date.c', 'lib/strftime.c', 'doc/coreutils.texi']) report.primarySource[path] = hash(execFileSync('/usr/bin/tar', ['-xOf', primaryArchive, `coreutils-9.7/${path}`], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }));
  for (const name of ['native-v1.json', 'native-after-v1.json', 'SEMANTICS.md', 'AUTHOR_HANDOFF.md']) {
    await fixture(evidenceRevision, `tests/commands/time-env/fraction-expansion/${name}`, join(output, 'historical', name));
  }
  report.historicalEvidenceTrees = {};
  for (const revision of [originalSource, '75d4e0c', '2542cfa', evidenceRevision]) {
    report.historicalEvidenceTrees[revision] = git(['ls-tree', '-r', revision, '--', 'tests/commands/time-env', 'tests/commands/time-env-stress']).toString().split('\n').filter(line => line.includes('/evidence/') || line.includes('MANIFEST') || line.includes('CHECKPOINT'));
  }
  const originalTests = git(['ls-tree', '-r', '--name-only', originalSource, '--', 'tests/commands/time-env']).toString().trim().split('\n').filter(path => path.endsWith('.test.ts'));
  const regressionTests = ['format-regressions.test.ts', 'sleep-regressions.test.ts'].map(name => `tests/commands/time-env/${name}`);
  const featureTests = ['nanoseconds.test.ts', 'iso-year.test.ts'].map(name => `tests/commands/time-env/fraction-expansion/${name}`);
  const supporting = ['helpers.ts', 'date-cases.ts', 'tsconfig.json'].map(name => `tests/commands/time-env/${name}`);
  for (const [revision, paths] of [[originalSource, [...originalTests, ...supporting]], ['db369ef', regressionTests], [evidenceRevision, [...featureTests, 'tests/commands/time-env/fraction-expansion/native-v1.json']]]) {
    for (const path of paths) assert.equal(await fileHash(join(build, path)), hash(await fixture(revision, path)), `unchanged ${path}`);
  }
  report.testFiles = { original223: originalTests, existing83: regressionTests, new54: featureTests };
  assert.equal(await execute('build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']), 0);
  report.buildHashes = await hashes(join(build, 'dist'));
  const npm = await realpath(join(dirname(process.execPath), 'npm'));
  report.npm = { path: npm, sha256: await fileHash(npm) };
  assert.equal(await execute('npm-pack', [npm, 'pack', '--offline', '--ignore-scripts', '--json', '--cache', join(scratch, 'npm-cache'), '--pack-destination', scratch]), 0);
  const packageDetails = JSON.parse(await readFile(join(output, 'npm-pack.stdout')))[0];
  const tarball = join(scratch, packageDetails.filename);
  report.package = { ...packageDetails, sha256: await fileHash(tarball) };
  await mkdir(installed, { recursive: true });
  assert.equal(await execute('extract-package', ['-xf', tarball, '--strip-components=1', '-C', installed], consumer, {}, '/usr/bin/tar'), 0);
  await save(join(consumer, 'package.json'), { name: 'independent-fraction-packed-consumer', private: true, type: 'module' });
  report.consumerIdentity = JSON.parse(await readFile(join(consumer, 'package.json')));
  report.installedHashes = await hashes(installed);
  assert.ok(Object.values(report.installedHashes).every(value => typeof value === 'string'));
  assert.equal(report.installedHashes['package.json'], report.originalConfigs['package.json']);
  report.packageManifest = JSON.parse(await readFile(join(installed, 'package.json')));
  assert.deepEqual(report.packageManifest.dependencies ?? {}, {});
  for (const [path, expected] of Object.entries(report.buildHashes)) assert.equal(report.installedHashes[`dist/${path}`], expected, path);
  const holdout = await fixture('2542cfa', 'tests/commands/time-env-stress/fix-review/holdout.mts', join(consumer, 'holdout.mts'));
  await save(join(output, 'inputs/holdout.mts.txt'), holdout);
  const guard = await fixture('2542cfa', 'tests/commands/time-env-stress/fix-review/guard.mjs', join(consumer, 'guard.mjs'));
  await save(join(output, 'inputs/guard.mjs.txt'), guard);
  const oldConsumer = await fixture('75d4e0c', 'tests/commands/time-env-stress/consumer.mts');
  const adaptedConsumer = adapt(oldConsumer, [
    ['"./dist/index.js"', '"virtual-bash"', 2],
    ['"./dist/commands/time-env/index.js"', '"./node_modules/virtual-bash/dist/commands/time-env/index.js"', 2],
  ], 'original305 import and import.meta.resolve paths only; all assertions/categories unchanged');
  await save(join(consumer, 'original305.mts'), adaptedConsumer);
  await save(join(output, 'inputs/original305.original.mts.txt'), oldConsumer);
  await save(join(output, 'inputs/original305.adapted.mts.txt'), adaptedConsumer);
  const neighbors = await fixture('db369ef', 'tests/commands/time-env/fix-review/native-neighbors.mjs');
  const adaptedNeighbors = adapt(neighbors, [
    ["'./dist/commands/time-env/index.js'", "'./node_modules/virtual-bash/dist/commands/time-env/index.js'", 1],
    ["'./dist/fs/memory/index.js'", "'virtual-bash'", 1],
  ], 'immutable36 neighbor matrix import paths only; no profile or oracle changes');
  await save(join(consumer, 'neighbors.mjs'), adaptedNeighbors);
  await save(join(output, 'inputs/neighbors.adapted.mjs.txt'), adaptedNeighbors);
  for (const name of ['controls.mts', 'public-positive.mts', 'public-negative.mts', 'leaf-positive.mts', 'leaf-negative.mts', 'public-time-env-unavailable.mts']) {
    const bytes = await readFile(join(own, name)); await save(join(consumer, name), bytes); report.fixtures[`owned:${name}`] = { sha256: hash(bytes) };
  }
  const typeArgs = [join(build, 'node_modules/typescript/bin/tsc'), '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--types', 'node', '--typeRoots', join(build, 'node_modules/@types')];
  const positiveFiles = ['public-positive.mts', 'leaf-positive.mts', 'controls.mts', 'holdout.mts', 'original305.mts'];
  assert.equal(await execute('consumer-types', [...typeArgs, '--noEmit', ...positiveFiles], consumer), 0);
  assert.equal(await execute('consumer-build', [...typeArgs, ...positiveFiles], consumer), 0);
  report.emittedConsumerHashes = {};
  for (const name of positiveFiles) report.emittedConsumerHashes[name.replace('.mts', '.mjs')] = await fileHash(join(consumer, name.replace('.mts', '.mjs')));
  await negativeTypes('public-negative-types', 'public-negative.mts', [2353, 2322], typeArgs);
  await negativeTypes('internal-leaf-negative-types', 'leaf-negative.mts', [2353, 2322, 2741, 2322, 2322], typeArgs);
  await negativeTypes('public-time-env-unavailable-types', 'public-time-env-unavailable.mts', [2724, 2305], typeArgs);
  const sourceArguments = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-timeout=30000'];
  await execute('source-original223', [...sourceArguments, ...originalTests]);
  await execute('source-existing83', [...sourceArguments, ...regressionTests]);
  await execute('source-new54', [...sourceArguments, ...featureTests]);
  assert.equal(await execute('source-scoped-types', ['node_modules/typescript/bin/tsc', '-p', 'tests/commands/time-env/tsconfig.json', '--noEmit']), 0);
  assert.equal(await execute('source-feature-types', ['node_modules/typescript/bin/tsc', '-p', 'tests/commands/time-env/fraction-expansion/tsconfig.json', '--noEmit']), 0);
  const runtimeArguments = ['--unhandled-rejections=strict', '--import', './guard.mjs'];
  await execute('packed-original305', [...runtimeArguments, 'original305.mjs'], consumer);
  await execute('packed-immutable304', [...runtimeArguments, 'holdout.mjs'], consumer);
  await execute('packed-existing36-profile', [...runtimeArguments, 'neighbors.mjs'], consumer);
  await execute('packed-independent-controls', [...runtimeArguments, 'controls.mjs'], consumer);
  assert.equal(await execute('packed-public-positive', [...runtimeArguments, 'public-positive.mjs'], consumer), 0);
  assert.equal(await execute('guard-negative-build-tree', [...runtimeArguments, '--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(build, 'dist/index.js')).href)})`], consumer), 1);
  const guardDiagnostic = await readFile(join(output, 'guard-negative-build-tree.stderr'), 'utf8');
  assert.match(guardDiagnostic, /AssertionError/); assert.match(guardDiagnostic, /archive\/dist\/index\.js/);
  const importLog = (await readFile(join(output, 'packed-imports.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  report.imports = { rows: importLog.length, sha256: await fileHash(join(output, 'packed-imports.jsonl')), resolved: [...new Set(importLog.map(row => row.url))].sort() };
  const canonicalRoot = pathToFileURL(await realpath(installed) + '/').href;
  assert.ok(importLog.every(row => row.url.startsWith(canonicalRoot)));
  assert.ok(importLog.some(row => row.specifier === 'virtual-bash' && row.url === canonicalRoot + 'dist/index.js'));
  assert.deepEqual(await hashes(installed), report.installedHashes);
  assert.deepEqual(await hashes(join(build, 'src')), report.sourceFiles);
  for (const [path, expected] of Object.entries(report.originalConfigs)) assert.equal(await fileHash(join(build, path)), expected);
  assert.equal(await trackedDigest(), report.trackedArchive.orderedPathAndHashSha256);
  assert.deepEqual(await hashes(join(build, 'node_modules')), toolsBefore);
  report.frozenInputsUnchanged = true;
  const oldRows = JSON.parse(await readFile(join(output, 'holdouts.json'))).rows;
  const newRows = JSON.parse(await readFile(join(output, 'hidden-rows.json'))).rows;
  const controlRows = JSON.parse(await readFile(join(output, 'controls.json'))).rows;
  const profileRows = JSON.parse(await readFile(join(output, 'fresh-native-matrix.json'))).rows;
  report.summary = {};
  for (const [name, rows] of [['original305', oldRows], ['immutable304', newRows], ['independentControls', controlRows]]) {
    report.summary[name] = { total: rows.length, pass: rows.filter(row => row.result === 'pass').length,
      fail: rows.filter(row => row.result === 'fail').length, failures: rows.filter(row => row.result === 'fail').map(row => ({ name: row.name, category: row.category, scope: row.scope })) };
  }
  report.summary.originalSleep8 = { rows: oldRows.filter(row => ['public-sleep-lifecycle', 'public-sleep-isolation'].includes(row.category)).map(row => ({ name: row.name, result: row.result })) };
  report.summary.existingProfile36 = { total: profileRows.length, gnuMatch: profileRows.filter(row => row.gnuMatch).length,
    appleMatch: profileRows.filter(row => row.appleMatch).length, nonmatches: profileRows.filter(row => !row.gnuMatch).map(row => ({ category: row.category, args: row.args, zone: row.env.TZ })) };
  assert.equal(oldRows.length, 305); assert.equal(newRows.length, 304); assert.equal(report.summary.originalSleep8.rows.length, 8); assert.equal(profileRows.length, 36);
  assert.equal(report.commands['source-original223'].counts.tests, 223); assert.equal(report.commands['source-existing83'].counts.tests, 83); assert.equal(report.commands['source-new54'].counts.tests, 54);
  report.completed = true;
} catch (error) {
  report.harnessError = { name: error.name, message: error.message, stack: error.stack }; process.exitCode = 1;
  console.error(error);
} finally {
  await rm(scratch, { recursive: true, force: true });
  await assert.rejects(lstat(scratch), { code: 'ENOENT' });
  report.cleanedOwnedScratch = true; report.finishedAt = new Date().toISOString();
  report.stagedAfter = git(['diff', '--cached', '--raw']).toString();
  report.movingHeadAfter = git(['rev-parse', 'HEAD']).toString().trim();
  await save(join(output, 'manifest.json'), report);
}

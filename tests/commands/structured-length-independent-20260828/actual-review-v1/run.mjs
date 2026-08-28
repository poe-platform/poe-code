import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const revision = dirname(fileURLToPath(import.meta.url)), owned = dirname(revision), repository = resolve(owned, '../../..');
const baseline = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
const candidate = '74361026502d76b8c2b696f9c60e410ac9b78d95';
const freeze = '20351e9920f89cc2a07a98eb24ac062f42be78ad';
const sourcePath = 'src/commands/structured/interpreter.ts';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = resolve(process.argv[2] ?? '');
assert.ok(output.startsWith(`${revision}${sep}`)); await mkdir(dirname(output), { recursive: true }); await mkdir(output);
const git = args => {
  const result = spawnSync('/usr/bin/git', args, { cwd: repository, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString()); return result.stdout;
};
const oldBytes = git(['show', `${baseline}:${sourcePath}`]), newBytes = git(['show', `${candidate}:${sourcePath}`]);
assert.equal(hash(oldBytes), 'bac1cf5325eff5bfa69f1c8bec5d3d8a80bb452fd61cdc802d55a26788acaffc');
assert.equal(hash(newBytes), 'e32ad45efe69544ed95b43b97f191006f10d3beea9ca9e2a3327843dffd45a74');
const oldArm = '      else if (typeof input === "string") yield Array.from(input).length;';
const newArm = '      else if (typeof input === "string") {\n        let length = 0;\n        for (const _ of input) length++;\n        yield length;\n      }';
assert.equal(oldBytes.toString().split(oldArm).length, 2);
assert.equal(newBytes.toString(), oldBytes.toString().replace(oldArm, newArm));
assert.equal(git(['diff-tree', '--no-commit-id', '--name-only', '-r', candidate]).toString().trim(), sourcePath);
const historic = JSON.parse(git(['show', 'c05ea6ed:tests/commands/structured-length-independent-20260828/baseline-v2/REPORT.json']));
const originalSeal = JSON.parse(git(['show', 'c05ea6ed:tests/commands/structured-length-independent-20260828/SEAL.json']));
for (const [name, expected] of Object.entries(originalSeal)) assert.equal(hash(await readFile(join(owned, name))), expected, `original ${name}`);
const holdouts = {};
for (const name of ['worker.mjs', 'vectors.json', 'deny-native.mjs']) {
  const bytes = await readFile(join(owned, name));
  assert.deepEqual(bytes, git(['show', `${freeze}:tests/commands/structured-length-independent-20260828/${name}`]));
  holdouts[name] = hash(bytes);
}
const author = join(repository, 'tests/commands/structured-length-author-20260828/evidence-candidate-v1');
const archive = join(author, 'SOURCE.tar'), pack = join(author, 'package/candidate/virtual-bash-0.0.0.tgz');
assert.equal(hash(await readFile(archive)), '9b9b7c8a7e4c117c2348dfcbc06be64f6dc569301182142122e806d8c7282625');
assert.equal(hash(await readFile(pack)), '351e03ad72b0bd82bb16d97cc50ec80b136edeaf705ec1590b414cb4cdf8b82e');
const authorManifestBytes = await readFile(join(author, 'SOURCE-MANIFEST.json'));
assert.equal(hash(authorManifestBytes), '061505eb9501b094074c82eb6b8b01e545bedb4aec7280ec9a4d408219897c3a');
const authorManifest = JSON.parse(authorManifestBytes);
assert.deepEqual(authorManifest.entries.map(row => row.path).sort(), Object.keys(historic.source).sort());
const scratch = await realpath(await mkdtemp(join(tmpdir(), 'safe-bash-length-actual-review-')));
const source = join(scratch, 'source'); await mkdir(source);
const environment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: scratch, TMPDIR: scratch, LC_ALL: 'C', LANG: 'C', TZ: 'UTC',
  npm_config_cache: join(scratch, 'npm-cache'), npm_config_userconfig: join(scratch, 'empty-npmrc'), npm_config_globalconfig: join(scratch, 'empty-global-npmrc') };
await writeFile(environment.npm_config_userconfig, ''); await writeFile(environment.npm_config_globalconfig, '');
const report = { baseline, candidate, recipe: 'fixed5137 selected inputs plus exact candidate interpreter; not the complete candidate HEAD', freeze,
  started: new Date().toISOString(), runnerSha256: hash(await readFile(fileURLToPath(import.meta.url))), holdouts,
  runtime: { path: process.execPath, version: process.version, sha256: hash(await readFile(process.execPath)) },
  archive: { sha256: hash(await readFile(archive)), entries: authorManifest.entries.length }, pack: { sha256: hash(await readFile(pack)) },
  sourceBefore: {}, tools: historic.tools, phases: [], packages: [], nativeOracleExecutions: 0, rssMeasurements: 0, productEdits: false };
const execute = (id, command, args, cwd, extra = {}) => {
  const result = spawnSync(command, args, { cwd, env: { ...environment, ...extra }, detached: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error && result.pid) { try { process.kill(-result.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  const phase = { id, command, args, cwd, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
    stdout: result.stdout?.toString() ?? '', stderr: result.stderr?.toString() ?? '' };
  report.phases.push(phase); return phase;
};
const node = (id, args, cwd, extra) => execute(id, process.execPath, args, cwd, extra);
const requireSuccess = phase => { assert.equal(phase.error, null, phase.id); assert.equal(phase.exitCode, 0, `${phase.id}: ${phase.stdout}\n${phase.stderr}`); return phase; };
const inventory = async root => {
  const rows = {};
  const walk = async relative => {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const child = join(relative, name), stat = await lstat(join(root, child));
      assert.equal(stat.isSymbolicLink(), false, child);
      if (stat.isDirectory()) { rows[child] = null; await walk(child); }
      else { assert.ok(stat.isFile()); rows[child] = hash(await readFile(join(root, child))); }
    }
  }; await walk(''); return rows;
};
const regular = inventory => Object.fromEntries(Object.entries(inventory).filter(([, value]) => value !== null));
const copyBuilt = async destination => {
  await mkdir(destination, { recursive: true }); await writeFile(join(destination, 'package.json'), await readFile(join(source, 'package.json')));
  for (const [name, digest] of Object.entries(await inventory(join(source, 'dist')))) if (digest !== null) {
    const target = join(destination, 'dist', name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, await readFile(join(source, 'dist', name)));
  }
};
const observePackage = async (label, packageRoot, modes) => {
  const consumer = resolve(packageRoot, '../..');
  for (const name of ['worker.mjs', 'vectors.json']) await writeFile(join(consumer, name), await readFile(join(owned, name)));
  const files = regular(await inventory(packageRoot));
  const manifest = { candidate: label === 'reverted' ? `${candidate}:exact-old-arm-reversion` : candidate, root: packageRoot, files };
  const bytes = Buffer.from(JSON.stringify(manifest)); const manifestPath = join(consumer, 'manifest.json'); await writeFile(manifestPath, bytes);
  const before = await inventory(consumer);
  const receipts = {};
  for (const mode of modes) {
    const phase = requireSuccess(node(`${label}-${mode}`, ['--permission', `--allow-fs-read=${consumer}`, join(consumer, 'worker.mjs'), mode, manifestPath, hash(bytes)], consumer));
    phase.receipt = JSON.parse(phase.stdout); receipts[mode] = phase.receipt;
    if (mode === 'allocation') {
      const target = join(output, `${label}-allocation.json`); const data = Buffer.from(phase.stdout); await writeFile(target, data);
      const checked = node(`${label}-require-noncollecting`, [join(revision, 'require-noncollecting.mjs'), target, hash(data), hash(bytes)], consumer);
      if (label === 'reverted') { assert.equal(checked.exitCode, 1); assert.match(checked.stderr, /actual bound interpreter must not collect the sentinel/); }
      else requireSuccess(checked);
    }
  }
  assert.deepEqual(await inventory(consumer), before);
  report.packages.push({ label, files, manifestSha256: hash(bytes), actualInterpreterSha256: files['dist/commands/structured/interpreter.js'], unchanged: true });
  return { consumer, manifestPath, manifestHash: hash(bytes), receipts, before };
};
try {
  const listing = requireSuccess(execute('source-archive-members', '/usr/bin/tar', ['-tf', archive], scratch)).stdout.trim().split('\n');
  assert.deepEqual(listing.sort(), Object.keys(historic.source).sort());
  const verbose = requireSuccess(execute('source-archive-regular-types', '/usr/bin/tar', ['-tvf', archive], scratch)).stdout.trim().split('\n');
  assert.ok(verbose.every(line => line.startsWith('-')));
  const extracted = join(scratch, 'author-source'); await mkdir(extracted);
  requireSuccess(execute('extract-authenticated-source-archive', '/usr/bin/tar', ['-xf', archive, '-C', extracted], scratch));
  for (const [name, metadata] of Object.entries(historic.source)) {
    const bytes = name === sourcePath ? newBytes : git(['cat-file', 'blob', metadata.blob]);
    const expected = authorManifest.entries.find(row => row.path === name);
    assert.equal(expected.sha256, hash(bytes), name); assert.equal(expected.bytes, bytes.length, name);
    assert.deepEqual(await readFile(join(extracted, name)), bytes, `author archive ${name}`);
    const destination = join(source, name); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes);
    report.sourceBefore[name] = hash(bytes);
  }
  assert.deepEqual(Object.keys(regular(await inventory(extracted))).sort(), Object.keys(historic.source).sort());
  for (const [name, metadata] of Object.entries(historic.tools)) {
    const bytes = await readFile(join(repository, 'node_modules', name)); assert.equal(hash(bytes), metadata.sha256, name);
    const destination = join(source, 'node_modules', name); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes); await chmod(destination, metadata.mode);
  }
  const original = await inventory(source);
  requireSuccess(node('candidate-strict-build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json', '--skipLibCheck', 'false'], source));
  const candidateDist = await inventory(join(source, 'dist'));
  const npmCli = await realpath(join(dirname(process.execPath), 'npm'));
  report.npm = { path: npmCli, sha256: hash(await readFile(npmCli)) };
  const installedConsumer = join(scratch, 'installed'); await mkdir(installedConsumer);
  await writeFile(join(installedConsumer, 'package.json'), '{"name":"length-independent-consumer","private":true,"type":"module"}\n');
  const packMembers = requireSuccess(execute('pack-members', '/usr/bin/tar', ['-tf', pack], scratch)).stdout.trim().split('\n');
  assert.ok(packMembers.every(name => name.startsWith('package/') && !name.includes('..') && !name.includes('AGENTS.md')));
  const packTypes = requireSuccess(execute('pack-regular-types', '/usr/bin/tar', ['-tvf', pack], scratch)).stdout.trim().split('\n');
  assert.ok(packTypes.every(line => line.startsWith('-')));
  requireSuccess(node('offline-install-exact-author-pack', [npmCli, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', pack], installedConsumer));
  const installedPackage = join(installedConsumer, 'node_modules/virtual-bash');
  const expectedPackage = { 'package.json': report.sourceBefore['package.json'], ...Object.fromEntries(Object.entries(regular(candidateDist)).map(([name, digest]) => [`dist/${name}`, digest])) };
  assert.deepEqual(regular(await inventory(installedPackage)), expectedPackage, 'every packed file must match fresh independent build');
  assert.deepEqual(packMembers.map(name => name.slice('package/'.length)).sort(), Object.keys(expectedPackage).sort());
  report.pack.filesMatchedIndependentBuild = Object.keys(expectedPackage).length;
  const candidateConsumer = join(scratch, 'moved'); await mkdir(join(candidateConsumer, 'node_modules'), { recursive: true });
  const candidatePackage = join(candidateConsumer, 'node_modules/virtual-bash'); await rename(installedPackage, candidatePackage);
  await assert.rejects(access(installedPackage), error => error.code === 'ENOENT');
  const candidateObserved = await observePackage('candidate', candidatePackage, ['semantics', 'allocation', 'trusted-iterator', 'public']);
  assert.equal(candidateObserved.receipts.allocation.observations[0].productCollected, false);
  const typeFile = join(candidateConsumer, 'consumer.ts'); const consumerTypeBytes = await readFile(join(revision, 'consumer.ts.data'));
  await writeFile(typeFile, consumerTypeBytes);
  const typeConfig = { compilerOptions: { target: 'ES2023', lib: ['ES2023'], module: 'NodeNext', moduleResolution: 'NodeNext',
    strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: false,
    typeRoots: [join(source, 'node_modules/@types')] }, files: ['./consumer.ts'] };
  await writeFile(join(candidateConsumer, 'tsconfig.json'), JSON.stringify(typeConfig));
  requireSuccess(node('moved-public-consumer-types', [join(source, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], candidateConsumer));
  await writeFile(typeFile, Buffer.concat([consumerTypeBytes, Buffer.from('\nconst invalid: StructuredCommandsOptions = { limits: { maxSteps: "one" } };\n')]));
  const badType = node('moved-public-type-negative', [join(source, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], candidateConsumer);
  assert.equal(badType.exitCode, 2); assert.equal((badType.stdout.match(/error TS2322:/g) ?? []).length, 1);
  assert.equal((badType.stdout.match(/error TS\d+:/g) ?? []).length, 1); await rm(typeFile); await rm(join(candidateConsumer, 'tsconfig.json'));
  const interpreter = join(candidatePackage, 'dist/commands/structured/interpreter.js'), interpreterBytes = await readFile(interpreter);
  await writeFile(interpreter, Buffer.concat([interpreterBytes, Buffer.from('\n;void 0;\n')]));
  const changed = node('changed-module-denied', ['--permission', `--allow-fs-read=${candidateConsumer}`, join(candidateConsumer, 'worker.mjs'), 'semantics', candidateObserved.manifestPath, candidateObserved.manifestHash], candidateConsumer);
  assert.equal(changed.exitCode, 1); assert.match(changed.stderr, /dist\/commands\/structured\/interpreter\.js/); await writeFile(interpreter, interpreterBytes);
  const badManifest = node('changed-manifest-denied', ['--permission', `--allow-fs-read=${candidateConsumer}`, join(candidateConsumer, 'worker.mjs'), 'semantics', candidateObserved.manifestPath, '0'.repeat(64)], candidateConsumer);
  assert.equal(badManifest.exitCode, 1); assert.match(badManifest.stderr, /controller-authenticated execution manifest/);
  const fallback = node('source-fallback-denied', ['--permission', `--allow-fs-read=${candidateConsumer}`, '--input-type=module', '-e', 'await import(process.argv[1])', join(source, 'dist/index.js')], candidateConsumer);
  assert.equal(fallback.exitCode, 1); assert.match(fallback.stderr, /ERR_ACCESS_DENIED/);
  assert.deepEqual(await inventory(candidateConsumer), candidateObserved.before);
  await writeFile(join(source, 'deny-native.mjs'), await readFile(join(owned, 'deny-native.mjs')));
  const nativeLog = join(scratch, 'native-denial.jsonl'); await writeFile(nativeLog, '');
  for (const [id, pattern, name, count] of [
    ['semantic-regressions', '^(semantic matrix |prototype keys preserve data|integer-like keys retain)', 'semantics.test.ts', 91],
    ['bounded-resource-regressions', '^(limits protect hidden Cartesian expansion, collections, and emitted results|input, source, output, slurp and result budgets enforce boundary values)$', 'resources.test.ts', 2],
  ]) {
    const phase = requireSuccess(node(id, ['--import', join(source, 'deny-native.mjs'), '--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', `--test-name-pattern=${pattern}`, `tests/commands/structured/${name}`], source, { LENGTH_NATIVE_DENIAL_LOG: nativeLog }));
    phase.counts = Object.fromEntries([...phase.stdout.matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
    assert.deepEqual(phase.counts, { tests: count, pass: count, fail: 0, cancelled: 0, skipped: 0 });
  }
  assert.equal(await readFile(nativeLog, 'utf8'), ''); await rm(join(source, 'deny-native.mjs'));
  await writeFile(join(source, sourcePath), newBytes.toString().replace(newArm, oldArm));
  assert.deepEqual(await readFile(join(source, sourcePath)), oldBytes, 'actual one-arm source reversion');
  requireSuccess(node('reverted-strict-build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json', '--skipLibCheck', 'false'], source));
  const revertedPackage = join(scratch, 'reverted/node_modules/virtual-bash'); await copyBuilt(revertedPackage);
  assert.deepEqual(regular(await inventory(revertedPackage)), historic.movedPackage.files, 'fresh reversion rebuild equals independently captured baseline package bytes');
  const revertedObserved = await observePackage('reverted', revertedPackage, ['semantics', 'allocation', 'trusted-iterator', 'public']);
  assert.equal(revertedObserved.receipts.allocation.observations[0].productCollected, true);
  await writeFile(join(source, sourcePath), newBytes);
  requireSuccess(node('restored-candidate-strict-build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json', '--skipLibCheck', 'false'], source));
  assert.deepEqual(await inventory(join(source, 'dist')), candidateDist);
  const restoredPackage = join(scratch, 'restored/node_modules/virtual-bash'); await copyBuilt(restoredPackage);
  const restoredObserved = await observePackage('restored', restoredPackage, ['allocation']);
  assert.equal(restoredObserved.receipts.allocation.observations[0].productCollected, false);
  const after = await inventory(source);
  for (const [name, digest] of Object.entries(original)) assert.deepEqual(after[name], digest, name);
  assert.deepEqual(Object.keys(after).filter(name => !(name in original) && name !== 'dist' && !name.startsWith('dist/')), []);
  assert.equal(hash(await readFile(pack)), report.pack.sha256); assert.equal(hash(await readFile(archive)), report.archive.sha256);
  report.verdict = 'bounded candidate accepted'; report.completed = true;
  report.prePost = { sourceAndToolsRestoredExactly: true, builtCandidateRestoredExactly: true, movedCandidateUnchanged: true, newEntriesChecked: true };
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  await rm(scratch, { recursive: true, force: true }); report.scratchRemoved = true; report.finished = new Date().toISOString();
  await writeFile(join(output, 'REPORT.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ completed: report.completed ?? false, phases: report.phases.map(phase => ({ id: phase.id, exitCode: phase.exitCode })), failure: report.failure, output }) + '\n');
}

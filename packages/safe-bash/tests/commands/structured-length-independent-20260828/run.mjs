import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, '../../..');
const baseline = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
const output = resolve(process.argv[2] ?? '');
assert.ok(output.startsWith(`${owned}${sep}`), 'fresh output must stay in the owned review directory');
await mkdir(dirname(output), { recursive: true }); await mkdir(output);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => {
  const result = spawnSync('/usr/bin/git', args, { cwd: repository, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString()); return result.stdout;
};
const proposal = git(['show', 'debfdd8b:tests/commands/yq-design-20260828/length-prerequisite-v1/README.md']);
assert.equal(hash(proposal), 'f97311654ee5ef5a8a97d4f0bb1f0036209c2fe342b19774b568b90cfdcdf6e4');
const sourcePath = 'src/commands/structured/interpreter.ts';
assert.equal(hash(git(['show', `${baseline}:${sourcePath}`])), 'bac1cf5325eff5bfa69f1c8bec5d3d8a80bb452fd61cdc802d55a26788acaffc');
const selected = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json',
  'tests/commands/structured/semantics.test.ts', 'tests/commands/structured/resources.test.ts', 'tests/commands/structured/helpers.ts',
  'tests/commands/structured-stress/jq-grammar-native-v3.ts', 'tests/commands/structured-stress/jq-grammar-native-v3.json'];
const records = git(['ls-tree', '-rz', '--full-tree', baseline, '--', ...selected]).toString().split('\0').filter(Boolean).map(line => {
  const [header, name] = line.split('\t'); const [mode, type, blob] = header.split(' ');
  assert.equal(mode, '100644'); assert.equal(type, 'blob'); assert.notEqual(name.split('/').at(-1), 'AGENTS.md');
  return { name, blob };
});
const toolPins = JSON.parse(git(['show', '0579a239:tests/integration/full-gate-20260827/loader-null-source-review-node24-bodies/attempt-1/RESULT.json'])).tools;
const scratch = await mkdtemp(join(tmpdir(), 'safe-bash-length-independent-'));
const source = join(scratch, 'source'); await mkdir(source);
const inventory = async root => {
  const rows = {};
  const walk = async relative => {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const child = join(relative, name), stat = await lstat(join(root, child));
      assert.equal(stat.isSymbolicLink(), false, child);
      if (stat.isDirectory()) { rows[child] = null; await walk(child); }
      else { assert.ok(stat.isFile()); rows[child] = hash(await readFile(join(root, child))); }
    }
  };
  await walk(''); return rows;
};
const report = { baseline, proposal: 'debfdd8b42930d8c5f1c0301897e4eeaa68e0979', started: new Date().toISOString(),
  freezeCommit: git(['log', '-1', '--format=%H', '--', 'tests/commands/structured-length-independent-20260828/worker.mjs']).toString().trim(),
  runtime: { path: process.execPath, version: process.version, sha256: hash(await readFile(process.execPath)) },
  source: {}, tools: toolPins, phases: [], movedPackage: null, implementationCandidateReviewed: false, realCandidateReversionMutant: 'pending candidate',
  nativeExecution: 0, allocationClaim: 'tiny sentinel collection discriminator only; no RSS or global allocation claim' };
const environment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: scratch, TMPDIR: scratch, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
const execute = (id, args, cwd, extraEnv = {}) => {
  const result = spawnSync(process.execPath, args, { cwd, env: { ...environment, ...extraEnv }, detached: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error && result.pid) { try { process.kill(-result.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  const phase = { id, args, cwd, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
    stdout: result.stdout?.toString() ?? '', stderr: result.stderr?.toString() ?? '' };
  report.phases.push(phase); return phase;
};
try {
  for (const record of records) {
    const bytes = git(['cat-file', 'blob', record.blob]);
    const destination = join(source, record.name); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes);
    report.source[record.name] = { blob: record.blob, sha256: hash(bytes) };
  }
  for (const [relative, metadata] of Object.entries(toolPins)) {
    const bytes = await readFile(join(repository, 'node_modules', relative)); assert.equal(hash(bytes), metadata.sha256, relative);
    const destination = join(source, 'node_modules', relative); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes); await chmod(destination, metadata.mode);
  }
  const sourceBefore = await inventory(source);
  report.sourceBeforeSha256 = hash(JSON.stringify(sourceBefore));
  const build = execute('build-authenticated-baseline', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], source);
  assert.equal(build.exitCode, 0, build.stderr + build.stdout);
  const dist = await inventory(join(source, 'dist'));
  const stage = join(scratch, 'consumer'), moved = join(stage, 'node_modules/virtual-bash'); await mkdir(moved, { recursive: true });
  const files = { 'package.json': hash(await readFile(join(source, 'package.json'))) };
  await writeFile(join(moved, 'package.json'), await readFile(join(source, 'package.json')));
  for (const [relative, digest] of Object.entries(dist)) {
    if (digest === null) continue;
    const destination = join(moved, 'dist', relative); await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(join(source, 'dist', relative))); files[`dist/${relative}`] = digest;
  }
  for (const name of ['worker.mjs', 'vectors.json']) await writeFile(join(stage, name), await readFile(join(owned, name)));
  const manifest = { candidate: baseline, root: moved, files, sourceInterpreterSha256: report.source[sourcePath].sha256 };
  const manifestBytes = Buffer.from(JSON.stringify(manifest)); const manifestPath = join(stage, 'manifest.json'); await writeFile(manifestPath, manifestBytes);
  report.movedPackage = { manifestSha256: hash(manifestBytes), ...manifest, delivery: 'regular-file moved built package with actual package.json; not an npm tarball' };
  const movedBefore = await inventory(stage);
  for (const mode of ['semantics', 'allocation', 'trusted-iterator', 'public']) {
    const phase = execute(mode, ['--permission', `--allow-fs-read=${stage}`, join(stage, 'worker.mjs'), mode, manifestPath, hash(manifestBytes)], stage);
    assert.equal(phase.exitCode, 0, `${mode}: ${phase.stderr}`);
    phase.receipt = JSON.parse(phase.stdout);
  }
  const allocation = report.phases.find(phase => phase.id === 'allocation').receipt.observations[0];
  assert.equal(allocation.productCollected, true, 'baseline must detect actual collecting source');
  report.desiredNoncollection = { status: 'FAIL on unchanged baseline', actualCollectingBranchDetected: true, expectedCandidateProductCollected: false };
  const changedFile = join(moved, 'dist/commands/structured/interpreter.js');
  const original = await readFile(changedFile); await writeFile(changedFile, Buffer.concat([original, Buffer.from('\n;void 0;\n')]));
  const tamper = execute('changed-built-module-denied', ['--permission', `--allow-fs-read=${stage}`, join(stage, 'worker.mjs'), 'semantics', manifestPath, hash(manifestBytes)], stage);
  assert.notEqual(tamper.exitCode, 0); assert.match(tamper.stderr, /dist\/commands\/structured\/interpreter\.js/);
  await writeFile(changedFile, original);
  const wrongBinding = execute('changed-manifest-denied', ['--permission', `--allow-fs-read=${stage}`, join(stage, 'worker.mjs'), 'semantics', manifestPath, '0'.repeat(64)], stage);
  assert.notEqual(wrongBinding.exitCode, 0); assert.match(wrongBinding.stderr, /controller-authenticated execution manifest/);
  assert.deepEqual(await inventory(stage), movedBefore);
  await writeFile(join(source, 'deny-native.mjs'), await readFile(join(owned, 'deny-native.mjs')));
  const denialLog = join(scratch, 'native-denial.jsonl'); await writeFile(denialLog, '');
  const patterns = [
    ['semantic-regressions', '^(semantic matrix |prototype keys preserve data|integer-like keys retain)', 'semantics.test.ts'],
    ['bounded-resource-regressions', '^(limits protect hidden Cartesian expansion, collections, and emitted results|input, source, output, slurp and result budgets enforce boundary values)$', 'resources.test.ts'],
  ];
  for (const [id, pattern, name] of patterns) {
    const phase = execute(id, ['--import', join(source, 'deny-native.mjs'), '--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1',
      `--test-name-pattern=${pattern}`, `tests/commands/structured/${name}`], source, { LENGTH_NATIVE_DENIAL_LOG: denialLog });
    assert.equal(phase.exitCode, 0, phase.stderr + phase.stdout);
    phase.counts = Object.fromEntries([...phase.stdout.matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  }
  assert.equal(await readFile(denialLog, 'utf8'), '');
  await rm(join(source, 'deny-native.mjs'));
  const sourceAfter = await inventory(source);
  for (const [name, digest] of Object.entries(sourceBefore)) assert.deepEqual(sourceAfter[name], digest, name);
  assert.deepEqual(Object.keys(sourceAfter).filter(name => !(name in sourceBefore) && name !== 'dist' && !name.startsWith('dist/')), []);
  assert.deepEqual(await inventory(join(source, 'dist')), dist);
  report.prePost = { sourceAndToolsUnchanged: true, builtAndMovedModulesUnchanged: true, newEntriesChecked: true, allowedGeneratedDirectory: 'dist' };
  report.completed = true;
} catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  await rm(scratch, { recursive: true, force: true }); report.scratchRemoved = true; report.finished = new Date().toISOString();
  await writeFile(join(output, 'REPORT.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ completed: report.completed ?? false, phases: report.phases.map(phase => ({ id: phase.id, exitCode: phase.exitCode, counts: phase.counts })), failure: report.failure, output }) + '\n');
}

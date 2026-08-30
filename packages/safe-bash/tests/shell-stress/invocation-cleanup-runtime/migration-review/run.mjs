import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const base = 'tests/shell-stress/invocation-cleanup-runtime';
const fixture = 'tests/shell/invocation-cleanup-public.test.ts';
const probePath = `${base}/public-worker.mjs`;
const helperPath = `${base}/migration/binding.ts`;
const expected = JSON.parse(readFileSync(join(here, 'expected-inputs.json')));
const initial = JSON.parse(readFileSync(join(here, 'initial.json')));
const output = join(here, 'evidence-attempt-02');
const work = join(here, '.work-attempt-02');
const source = join(work, 'candidate');
const mutantSource = join(work, 'mutant');
const nested = join(work, 'nested');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const children = [];
const controls = [];
let prepared;
let accepted = false;
function save(name, data) {
  writeFileSync(join(output, name), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
}
function tree(directory, baseDirectory = directory) {
  const files = {};
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) Object.assign(files, tree(path, baseDirectory));
    else files[relative(baseDirectory, path)] = digest(readFileSync(path));
  }
  return files;
}
function inputs(directory) {
  return Object.fromEntries(Object.keys(expected.files).map(path => [path, digest(readFileSync(join(directory, path)))]));
}
function materialize(origin, destination) {
  const allowed = realpathSync(origin);
  function copy(input, outputPath) {
    const actual = realpathSync(input);
    assert.ok(actual === allowed || actual.startsWith(`${allowed}/`), `Copied tool escaped its explicit tree: ${actual}`);
    const stat = lstatSync(actual);
    if (stat.isDirectory()) {
      mkdirSync(outputPath);
      for (const name of readdirSync(actual)) copy(join(actual, name), join(outputPath, name));
    } else {
      assert.ok(stat.isFile());
      writeFileSync(outputPath, readFileSync(actual), { flag: 'wx', mode: stat.mode & 0o777 });
    }
    assert.equal(lstatSync(outputPath).isSymbolicLink(), false);
  }
  copy(allowed, destination);
}
function git(args) {
  const result = spawnSync('git', ['--no-replace-objects', ...args], { cwd: repository, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
const environment = { ...process.env, TMPDIR: nested, TMP: nested, TEMP: nested, TSX_DISABLE_CACHE: '1', NODE_OPTIONS: '--unhandled-rejections=strict', FORCE_COLOR: '0', NO_COLOR: '1' };
for (const key of ['NODE_TEST_CONTEXT', 'NODE_PATH', 'VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED', 'VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT']) delete environment[key];
function run(name, args, cwd, extra = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', ...args], {
    cwd, env: { ...environment, ...extra }, encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
  });
  writeFileSync(join(output, `${name}.stdout.log`), result.stdout ?? '', { flag: 'wx' });
  writeFileSync(join(output, `${name}.stderr.log`), result.stderr ?? '', { flag: 'wx' });
  const counts = Object.fromEntries([...(result.stdout ?? '').matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  const proof = { name, started, ended: new Date().toISOString(), args, cwd, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, counts };
  children.push(proof);
  save(`${name}.result.json`, proof);
  assert.equal(result.error, undefined, `${name}: ${result.error?.message}`);
  assert.equal(result.signal, null, `${name}: killed instead of settled`);
  return { ...result, counts };
}
function canonical(name, directory, expectationPath, revision = expected.revision) {
  return run(name, ['--import', 'tsx', '--test', fixture], directory, expectationPath ? {
    VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED: expectationPath, VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT: revision,
  } : {});
}
function parseDiagnostic(lines, position, prefix) {
  let content = '';
  for (let index = position; index < lines.length && lines[index].startsWith('# '); index++) {
    content += (index === position ? lines[index].slice(prefix.length) : lines[index].slice(2)).replace(/\\([\\#])/g, '$1');
    try { return JSON.parse(content); } catch {}
  }
  throw new Error(`Unparseable diagnostic at line ${position + 1}`);
}
function parseCanonical(result) {
  const lines = result.stdout.split('\n');
  const manifestIndex = lines.findIndex(line => line.startsWith('# PUBLIC_SOURCE_MANIFEST '));
  assert.ok(manifestIndex >= 0);
  const manifest = parseDiagnostic(lines, manifestIndex, '# PUBLIC_SOURCE_MANIFEST ');
  const reports = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith('# {"scenario":')) continue;
    const child = parseDiagnostic(lines, index, '# ');
    assert.equal(child.error, null);
    assert.equal(child.signal, null);
    const report = JSON.parse(child.stdout.trim());
    reports.push({ child, report });
  }
  assert.equal(reports.length, 10);
  assert.equal(new Set(reports.map(value => value.report.scenario)).size, 10);
  assert.match(result.stdout, /PUBLIC_SNAPSHOT_CLEANUP/);
  assert.equal(existsSync(manifest.snapshot), false);
  for (const { report } of reports) {
    assert.equal(report.sourcePinned, true);
    assert.equal(report.publicEntry, join(manifest.snapshot, 'dist/index.js'));
    assert.ok(report.imports['dist/index.js']);
    for (const [path, hash] of Object.entries(report.imports)) assert.equal(hash, manifest.emittedHashes[path]);
    for (const worker of report.workers) {
      assert.equal(worker.path, 'dist/commands/regex-execution/worker.js');
      assert.equal(worker.sha256, manifest.emittedHashes[worker.path]);
    }
  }
  return { manifest, reports };
}
function checkLifetime(report) {
  const event = name => report.events.find(item => item.name === name);
  for (const boundary of report.boundaries) {
    for (const worker of boundary.workers) {
      assert.equal(worker.exited, true);
      assert.equal(worker.terminationDone, true);
      assert.ok(worker.terminateCalls > 0);
      for (const name of ['native-worker-exit', 'native-terminate-resolved']) {
        assert.ok(report.events.some(item => item.name === name && item.worker === worker.id && item.sequence < boundary.sequence));
      }
    }
  }
  if (report.scenario.endsWith('sibling')) {
    const held = event('exec-rejected-owned');
    const release = event('release-sibling-input');
    assert.ok(held.sequence < release.sequence);
    assert.ok(report.events.some(item => item.name === 'native-request-sent' && item.sequence < held.sequence));
    assert.ok(report.events.some(item => item.name === 'native-request-sent' && item.sequence > release.sequence));
    assert.ok(event('sibling-exec-settled').sequence > release.sequence);
    if (report.scenario.includes('other-shell')) assert.ok(event('dispose-settled-owned').sequence < release.sequence);
  }
}

assert.equal(existsSync(output), false, 'Never overwrite a prior attempt');
assert.equal(existsSync(work), false, 'Never reuse scratch');
mkdirSync(output);
mkdirSync(source, { recursive: true });
mkdirSync(nested);
process.env.TMPDIR = nested;
process.env.TMP = nested;
process.env.TEMP = nested;
process.env.NODE_OPTIONS = '--unhandled-rejections=strict';
try {
  assert.equal(digest(readFileSync(process.execPath)), initial.executableSha256);
  const controlCommit = git(['log', '-1', '--format=%H', '--', relative(repository, join(here, 'run.mjs'))]).toString().trim();
  for (const path of ['FREEZE.md', 'freeze.mjs', 'run.mjs', 'expected-inputs.json', 'initial.json', 'tools-before.json', 'readonly-before.json', 'semantic-comparison.json']) {
    assert.deepEqual(readFileSync(join(here, path)), git(['show', `${controlCommit}:${relative(repository, join(here, path))}`]));
  }
  save('execution-binding.json', { controlCommit, candidate: expected.revision, tree: expected.tree, node: process.version, executableSha256: initial.executableSha256, started: new Date().toISOString() });
  assert.deepEqual(tree(join(repository, 'node_modules')), JSON.parse(readFileSync(join(here, 'tools-before.json'))));
  for (const [path, hash] of Object.entries(expected.files)) {
    const bytes = git(['show', `${expected.revision}:${path}`]);
    assert.equal(digest(bytes), hash);
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), bytes, { flag: 'wx' });
  }
  materialize(join(repository, 'node_modules'), join(source, 'node_modules'));
  assert.deepEqual(tree(join(source, 'node_modules')), JSON.parse(readFileSync(join(here, 'tools-before.json'))));
  save('candidate-before.json', inputs(source));
  assert.deepEqual(inputs(source), expected.files);
  const positive = canonical('canonical-current', source, join(here, 'expected-inputs.json'));
  assert.equal(positive.status, 0, positive.stdout + positive.stderr);
  assert.deepEqual(positive.counts, { tests: 10, pass: 10, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  const current = parseCanonical(positive);
  assert.deepEqual(current.manifest.binding.inputs, expected.files);
  assert.equal(current.manifest.binding.revision, expected.revision);
  assert.equal(current.manifest.binding.tree, expected.tree);
  assert.equal(current.manifest.binding.expectedManifestSha256, digest(JSON.stringify(expected)));
  assert.equal(current.manifest.probeHash, expected.files[probePath]);
  for (const { child, report } of current.reports) {
    assert.equal(child.status, 0);
    assert.equal(child.stderr, '');
    assert.equal(report.passed, true);
    assert.equal(report.liveWorkers, 0);
    assert.deepEqual(report.unhandled, []);
    checkLifetime(report);
  }
  save('canonical-manifest.json', current.manifest);
  save('canonical-reports.json', current.reports);
  console.log('Actual canonical 10/10; loaded identities and lifetime ordering verified.');
  const wrongHash = structuredClone(expected);
  wrongHash.files['src/commands/regex-execution/client.ts'] = '0'.repeat(64);
  const omitted = structuredClone(expected);
  delete omitted.files['src/commands/regex-execution/client.ts'];
  const wrongRevision = { ...expected, revision: '1'.repeat(40) };
  for (const [name, value, message] of [
    ['null', null, 'Committed qualification requires an object manifest'],
    ['false', false, 'Committed qualification requires an object manifest'],
    ['wrong-hash', wrongHash, 'Executing inputs do not match'],
    ['omitted-input', omitted, 'Executing inputs do not match'],
    ['wrong-revision', wrongRevision, 'Expected values to be strictly equal'],
  ]) {
    const expectation = join(output, `expectation-${name}.json`);
    writeFileSync(expectation, JSON.stringify(value), { flag: 'wx' });
    const result = canonical(`negative-${name}`, source, expectation);
    assert.equal(result.status, 1);
    assert.deepEqual(result.counts, { tests: 10, pass: 0, fail: 10, cancelled: 0, skipped: 0, todo: 0 });
    assert.ok(result.stdout.includes(message));
    assert.doesNotMatch(result.stdout, /PUBLIC_SOURCE_MANIFEST/);
    controls.push({ name: `canonical-expectation-${name}`, rejected: true, rejectedRows: 10 });
  }
  const helper = await import(pathToFileURL(join(source, helperPath)).href);
  prepared = await helper.preparePublicSnapshot(source, expected);
  const beforeDist = tree(join(prepared.snapshot, 'dist'), prepared.snapshot);
  assert.deepEqual(beforeDist, current.manifest.emittedHashes, 'Independent fresh builds disagree');
  save('independent-build-manifest.json', prepared.manifest);
  save('emitted-before.json', beforeDist);
  for (const [name, path] of [
    ['source', 'src/commands/regex-execution/client.ts'],
    ['emitted', 'dist/shell/shell.js'],
    ['probe', probePath],
    ['manifest', 'public-manifest.json'],
  ]) {
    const target = join(prepared.snapshot, path);
    const original = readFileSync(target);
    let changed = Buffer.concat([original, Buffer.from('\n')]);
    if (name === 'manifest') {
      const manifest = JSON.parse(original);
      manifest.emittedHashes['dist/shell/shell.js'] = '0'.repeat(64);
      changed = Buffer.from(JSON.stringify(manifest));
    }
    try {
      writeFileSync(target, changed);
      await assert.rejects(prepared.verify());
      controls.push({ name: `binding-tamper-${name}`, rejected: true, path, original: digest(original), tampered: digest(changed) });
      if (name === 'emitted' || name === 'manifest') {
        const result = run(`negative-loaded-${name}`, [prepared.probe, prepared.manifestPath, 'grep:normal'], prepared.snapshot);
        assert.equal(result.status, 1);
        const report = JSON.parse(result.stdout.trim());
        assert.equal(report.passed, false);
        assert.equal(report.sourcePinned, false);
        assert.match(report.failure.message, /Emitted identity: dist\/shell\/shell.js/);
        assert.deepEqual(report.workers, []);
        assert.deepEqual(report.unhandled, []);
        controls.push({ name: `actual-loader-tamper-${name}`, rejected: true, message: report.failure.message });
      }
    } finally { writeFileSync(target, original); }
    await prepared.verify();
  }
  assert.deepEqual(tree(join(prepared.snapshot, 'dist'), prepared.snapshot), beforeDist);
  save('emitted-after.json', tree(join(prepared.snapshot, 'dist'), prepared.snapshot));
  await prepared.dispose();
  prepared = undefined;
  console.log('Five invalid envelopes, four binding tampers, two actual-loader tampers rejected.');
  materialize(source, mutantSource);
  const mutationPath = 'src/commands/regex-execution/client.ts';
  const original = readFileSync(join(mutantSource, mutationPath), 'utf8');
  const needle = 'if (!this.exited) await this.worker.terminate();';
  assert.equal(original.split(needle).length, 2);
  const patch = `*** Begin Patch\n*** Update File: ${mutationPath}\n@@\n-      ${needle}\n+      if (!this.exited) void this.worker.terminate();\n*** End Patch\n`;
  writeFileSync(join(output, 'retirement-mutant.patch'), patch, { flag: 'wx' });
  const applied = spawnSync('apply_patch', [patch], { cwd: mutantSource, encoding: 'utf8', timeout: 10000 });
  save('mutation-application.json', { status: applied.status, error: applied.error?.message ?? null, stdout: applied.stdout, stderr: applied.stderr });
  assert.equal(applied.error, undefined);
  assert.equal(applied.status, 0);
  assert.equal(readFileSync(join(mutantSource, mutationPath), 'utf8'), original.replace(needle, 'if (!this.exited) void this.worker.terminate();'));
  const mutantInputs = inputs(mutantSource);
  assert.deepEqual(Object.keys(expected.files).filter(path => mutantInputs[path] !== expected.files[path]), [mutationPath]);
  await assert.rejects(helper.assertInputsUnchanged(mutantSource, expected.files), /changed during public cleanup/);
  controls.push({ name: 'retirement-mutant-original-binding', rejected: true });
  save('mutant-inputs.json', { before: expected.files[mutationPath], after: mutantInputs[mutationPath], files: mutantInputs, qualification: 'deliberate one-expression mutant, not the candidate' });
  const negative = canonical('retirement-mutant-canonical', mutantSource);
  assert.equal(negative.status, 1);
  assert.equal(negative.counts.tests, 10);
  assert.equal(negative.counts.cancelled, 0);
  assert.equal(negative.counts.skipped, 0);
  assert.equal(negative.counts.todo, 0);
  const mutant = parseCanonical(negative);
  assert.equal(mutant.manifest.binding.profile, 'captured-working-tree-not-committed-qualification');
  assert.equal(mutant.manifest.binding.revision, null);
  assert.deepEqual(mutant.manifest.binding.inputs, mutantInputs);
  for (const command of ['grep', 'rg']) {
    const found = mutant.reports.find(value => value.report.scenario === `${command}:normal`);
    assert.equal(found.child.status, 1);
    assert.equal(found.report.passed, false);
    assert.equal(found.report.sourcePinned, true);
    assert.match(found.report.failure.message, /exec-settled:.*(?:has not exited|termination promise incomplete)/);
    assert.ok(found.report.workers.length > 0);
    assert.deepEqual(found.report.unhandled, []);
    controls.push({ name: `retirement-mutant-${command}-normal`, rejected: true, message: found.report.failure.message });
  }
  save('mutant-manifest.json', mutant.manifest);
  save('mutant-reports.json', mutant.reports);
  assert.deepEqual(inputs(mutantSource), mutantInputs);
  assert.deepEqual(inputs(source), expected.files);
  save('candidate-after.json', inputs(source));
  assert.deepEqual(tree(join(repository, base, 'migration')), JSON.parse(readFileSync(join(here, 'readonly-before.json'))));
  save('readonly-after.json', tree(join(repository, base, 'migration')));
  assert.deepEqual(tree(join(repository, 'node_modules')), JSON.parse(readFileSync(join(here, 'tools-before.json'))));
  save('tools-after.json', tree(join(repository, 'node_modules')));
  const live = inputs(repository);
  save('live-inputs-after.json', { files: live, changedSinceFreeze: Object.keys(expected.files).filter(path => live[path] !== expected.files[path]) });
  save('controls.json', controls);
  save('summary.json', {
    accepted: true, scope: 'only existing canonical ten and their migration binding; not whole-gate acceptance',
    candidate: expected.revision, candidateTree: expected.tree, canonical: positive.counts,
    negativeEnvelopeRows: 50, independentControlAssertions: controls.length,
    mutantCanonical: negative.counts,
    actualWorkers: current.reports.reduce((sum, value) => sum + value.report.workers.length, 0),
    publicBoundaries: current.reports.reduce((sum, value) => sum + value.report.boundaries.length, 0),
    emittedFileCount: Object.keys(beforeDist).length,
    loadedModuleCount: new Set(current.reports.flatMap(value => Object.keys(value.report.imports))).size,
    historicalFailedHooksPreserved: 10, historicalAndAuthorEvidenceUnchanged: true,
    otherCohortsNotAcceptance: ['author026e20cf/evidence9167913d', 'original85e6d560/4c16d9c5', 'originalb494 ten failed hooks', 'all negative controls and mutant'],
  });
  accepted = true;
  console.log('Retirement mutant rejected by unchanged canonical boundaries; bounded review accepted.');
} catch (error) {
  save('FAILURE.json', { message: error.message, stack: error.stack, controlsCompleted: controls });
  throw error;
} finally {
  if (prepared) await prepared.dispose();
  const remainingNested = existsSync(nested) ? readdirSync(nested) : [];
  rmSync(work, { recursive: true, force: true });
  save('children.json', children);
  save('CLEANUP.json', { time: new Date().toISOString(), accepted, ownScratch: work, removed: !existsSync(work), nestedBeforeFinalRemoval: remainingNested, synchronousChildWaitsReturned: children.length, allRecordedChildrenNatural: children.every(child => child.signal === null && child.error === null), noBroadKill: true, removedOnlyOwnedScratch: true });
}

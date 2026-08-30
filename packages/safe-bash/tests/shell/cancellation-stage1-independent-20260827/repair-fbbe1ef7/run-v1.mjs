import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { here, prior, repository, independentPath, pins, hash, inventory, historicalMembership, liveSnapshot, captureSeal, verifySeal } from './archive-v1.mjs';

const mode = process.argv[2];
const label = process.argv[3];
assert.ok(mode === 'capture' || mode === 'replay', 'run-v1.mjs capture|replay unique-label [seal.json]');
assert.match(label ?? '', /^[a-zA-Z0-9-]+$/);
const output = path.join(here, label);
assert.equal(existsSync(output), false, 'never overwrite previous attempts');
mkdirSync(output);
const json = (name, value) => writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
const scratch = path.join(output, 'scratch');
mkdirSync(scratch);
const fixtureMembership = () => readdirSync(here).sort().filter(name => lstatSync(path.join(here, name)).isFile())
  .map(name => ({ path: name, sha256: hash(readFileSync(path.join(here, name))) }));
const before = { at: new Date().toISOString(), history: historicalMembership(), ownFixtures: fixtureMembership(), live: liveSnapshot() };
json('before.json', before);
const processes = [];
let compilerBefore;
let originalNodeHash;
let originalNode;
let tools;
let seal;
let outcome = 'incomplete';
try {
  seal = mode === 'capture' ? captureSeal() : JSON.parse(readFileSync(path.resolve(process.argv[4])));
  const { archive, source, identity } = verifySeal(seal);
  json('seal.json', seal);
  json('authentication.json', identity);
  const controls = Object.fromEntries(['cohort-v1.mjs', 'positive-v1.ts.data', 'negative-v1.ts.data'].map(name =>
    [name, archive.file(pins.historicalAudit, `${independentPath}/${name}`)]));
  for (const [name, bytes] of Object.entries(controls)) assert.equal(hash(readFileSync(path.join(prior, name))), hash(bytes));
  json('control-binding.json', {
    historicalAudit: pins.historicalAudit, oldCandidate: pins.originalCandidate, newCandidate: pins.candidate,
    controls: Object.fromEntries(Object.entries(controls).map(([name, bytes]) => [name, hash(bytes)])),
    historicalV1: JSON.parse(archive.file(pins.historicalAudit, `${independentPath}/evidence-v1/summary.json`)),
    historicalV2: JSON.parse(archive.file(pins.historicalAudit, `${independentPath}/evidence-v2/summary.json`)),
    previousDriverSha256: hash(archive.file(pins.historicalAudit, `${independentPath}/review-v2.mjs`)),
    currentDriverSha256: hash(readFileSync(new URL('./run-v1.mjs', import.meta.url))),
    archiveDriverSha256: hash(readFileSync(new URL('./archive-v1.mjs', import.meta.url))),
    adaptations: 'new candidate seal, destination paths, layered history checks, four separate nearby records, exact unchanged control byte copies; no control edits',
  });
  tools = path.join(scratch, 'tools');
  mkdirSync(tools);
  compilerBefore = inventory(path.join(repository, 'node_modules/typescript'));
  cpSync(path.join(repository, 'node_modules/typescript'), path.join(tools, 'typescript'), { recursive: true, dereference: true });
  assert.deepEqual(inventory(path.join(tools, 'typescript')), compilerBefore);
  originalNode = realpathSync(process.execPath);
  originalNodeHash = hash(readFileSync(originalNode));
  cpSync(originalNode, path.join(tools, 'node'));
  assert.equal(hash(readFileSync(path.join(tools, 'node'))), originalNodeHash);
  json('tools-before.json', { node: { path: originalNode, version: process.version, sha256: originalNodeHash },
    typescriptVersion: JSON.parse(readFileSync(path.join(tools, 'typescript/package.json'))).version, compiler: compilerBefore });
  const node = path.join(tools, 'node');
  const compiler = path.join(tools, 'typescript/lib/tsc.js');
  function run(name, args, environment = {}) {
    const started = new Date().toISOString();
    const result = spawnSync(node, args, { cwd: scratch,
      env: { ...process.env, NODE_OPTIONS: '', TMPDIR: scratch, TMP: scratch, TEMP: scratch, ...environment },
      timeout: 90000, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(path.join(output, `${name}.stdout`), result.stdout ?? '');
    writeFileSync(path.join(output, `${name}.stderr`), result.stderr ?? '');
    const record = { name, command: [node, ...args], cwd: scratch, environment,
      started, finished: new Date().toISOString(), status: result.status, signal: result.signal,
      error: result.error ? String(result.error) : null, watchdogMilliseconds: 90000, watchdogUsed: result.error?.code === 'ETIMEDOUT' };
    processes.push(record);
    json('processes.json', processes);
    return { ...record, stdout: result.stdout?.toString() ?? '', stderr: result.stderr?.toString() ?? '' };
  }
  const options = { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
    target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2023', 'DOM'], types: [],
    skipLibCheck: false, declaration: true, noEmitOnError: true };
  const fixtures = path.join(scratch, 'fixtures');
  mkdirSync(fixtures);
  writeFileSync(path.join(fixtures, 'cohort-v1.mjs'), controls['cohort-v1.mjs']);
  cpSync(path.join(here, 'nearby-v1.mjs'), path.join(fixtures, 'nearby-v1.mjs'));
  const fixtureCopiesBefore = inventory(fixtures);
  function build(name, bytes) {
    const directory = path.join(scratch, name);
    mkdirSync(directory);
    writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}\n');
    writeFileSync(path.join(directory, 'cancellation.ts'), bytes);
    writeFileSync(path.join(directory, 'positive.ts'), controls['positive-v1.ts.data']);
    writeFileSync(path.join(directory, 'negative.ts'), controls['negative-v1.ts.data']);
    writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { ...options, outDir: './emitted' }, files: ['cancellation.ts', 'positive.ts'] }));
    writeFileSync(path.join(directory, 'negative.json'), JSON.stringify({ compilerOptions: { ...options, noEmit: true }, files: ['negative.ts'] }));
    const inputsBefore = inventory(directory);
    const result = run(`${name}-build`, [compiler, '-p', path.join(directory, 'tsconfig.json')]);
    const allAfter = inventory(directory);
    const inputsAfter = allAfter.filter(item => item.path !== 'emitted/' && !item.path.startsWith('emitted/'));
    assert.deepEqual(inputsAfter, inputsBefore, 'actual compiler input membership including additions');
    assert.equal(hash(readFileSync(path.join(directory, 'cancellation.ts'))), hash(bytes));
    json(`${name}-membership.json`, { inputsBefore, inputsAfter, allAfter });
    return { directory, result, allAfter };
  }
  function runtime(name, module, fixture, pattern) {
    const args = ['--test'];
    if (pattern) args.push('--test-name-pattern', pattern);
    args.push(fixture);
    const result = run(name, args, { CANCELLATION_MODULE: module });
    const passed = [...result.stdout.matchAll(/^ok \d+ - (.*)$/gm)].map(match => match[1]);
    const failed = [...result.stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]);
    return { result, passed, failed };
  }
  const candidate = build('candidate', source);
  assert.equal(candidate.result.status, 0, 'candidate must compile before runtime interpretation');
  const candidateModule = path.join(candidate.directory, 'emitted/cancellation.js');
  const original = runtime('original12-isolated', candidateModule, path.join(fixtures, 'cohort-v1.mjs'));
  const nearby = runtime('nearby4-isolated', candidateModule, path.join(fixtures, 'nearby-v1.mjs'));
  assert.equal(original.passed.length + original.failed.length, 12, 'all original tests loaded');
  assert.equal(nearby.passed.length + nearby.failed.length, 4, 'all nearby tests loaded');
  const negative = run('six-negatives-isolated', [compiler, '-p', path.join(candidate.directory, 'negative.json'), '--pretty', 'false']);
  function diagnostics(result) {
    const found = [...result.stdout.matchAll(/negative\.ts\((\d+),\d+\): error TS(\d+):/g)]
      .map(match => ({ line: Number(match[1]), code: Number(match[2]) }));
    assert.equal(result.status, 2);
    assert.deepEqual(found, [{ line: 2, code: 2322 }, { line: 3, code: 2740 }, { line: 4, code: 2740 },
      { line: 5, code: 2322 }, { line: 6, code: 2739 }, { line: 7, code: 2322 }]);
    assert.equal(/TS2307|Cannot find module/.test(result.stdout + result.stderr), false);
    assert.equal([...result.stdout.matchAll(/error TS\d+:/g)].length, 6, 'no unrelated diagnostics');
    return found;
  }
  const negativeDiagnostics = diagnostics(negative);
  assert.deepEqual(inventory(candidate.directory), candidate.allAfter, 'runtime/types did not alter input or emitted membership');
  const moved = path.join(scratch, 'moved-internal');
  mkdirSync(moved);
  const artifactIdentity = [];
  for (const name of ['cancellation.js', 'cancellation.d.ts']) {
    cpSync(path.join(candidate.directory, 'emitted', name), path.join(moved, name));
    const emittedHash = hash(readFileSync(path.join(candidate.directory, 'emitted', name)));
    const movedHash = hash(readFileSync(path.join(moved, name)));
    assert.equal(emittedHash, movedHash);
    artifactIdentity.push({ name, emittedHash, movedHash });
  }
  writeFileSync(path.join(moved, 'package.json'), '{"type":"module"}\n');
  writeFileSync(path.join(moved, 'positive.ts'), controls['positive-v1.ts.data']);
  writeFileSync(path.join(moved, 'negative.ts'), controls['negative-v1.ts.data']);
  writeFileSync(path.join(moved, 'cohort-v1.mjs'), controls['cohort-v1.mjs']);
  cpSync(path.join(here, 'nearby-v1.mjs'), path.join(moved, 'nearby-v1.mjs'));
  writeFileSync(path.join(moved, 'positive.json'), JSON.stringify({ compilerOptions: { ...options, noEmit: true }, files: ['positive.ts', 'cancellation.d.ts'] }));
  writeFileSync(path.join(moved, 'negative.json'), JSON.stringify({ compilerOptions: { ...options, noEmit: true }, files: ['negative.ts', 'cancellation.d.ts'] }));
  const movedBefore = inventory(moved);
  rmSync(candidate.directory, { recursive: true });
  assert.equal(existsSync(candidate.directory), false);
  const movedOriginal = runtime('original12-moved', path.join(moved, 'cancellation.js'), path.join(moved, 'cohort-v1.mjs'));
  const movedNearby = runtime('nearby4-moved', path.join(moved, 'cancellation.js'), path.join(moved, 'nearby-v1.mjs'));
  const movedPositive = run('positive-moved', [compiler, '-p', path.join(moved, 'positive.json')]);
  const movedNegative = run('six-negatives-moved', [compiler, '-p', path.join(moved, 'negative.json'), '--pretty', 'false']);
  assert.equal(movedPositive.status, 0);
  assert.deepEqual(diagnostics(movedNegative), negativeDiagnostics);
  assert.deepEqual(movedOriginal.passed, original.passed);
  assert.deepEqual(movedOriginal.failed, original.failed);
  assert.deepEqual(movedNearby.passed, nearby.passed);
  assert.deepEqual(movedNearby.failed, nearby.failed);
  assert.deepEqual(inventory(moved), movedBefore, 'moved inputs and emitted artifacts unchanged including additions');
  json('artifacts.json', { artifactIdentity, sourceRemovedBeforeMovedExecution: true, movedBefore, movedAfter: inventory(moved) });

  const priorMutants = JSON.parse(archive.file(pins.historicalAudit, `${independentPath}/evidence-v2/mutants.json`));
  const mutations = priorMutants.map(({ name, obligation, from, to }) => ({ name, obligation, from, to, family: 'prior-three' }));
  mutations.push({ name: 'repair-counterfactual-fanout', obligation: 'H04b', family: 'repair-two',
    from: 'if (state.closed) break;\n      if (!subscriber.active) continue;',
    to: 'if (!subscriber.active || state.closed) break;' });
  mutations.push({ name: 'repair-counterfactual-observation', obligation: 'H07b', family: 'repair-two',
    from: '    const deliveredControl = frame.delivered?.role === "budget-control" || frame.delivered?.role === "pipeline-control"\n      ? frame.delivered\n      : undefined;\n    if (deliveredControl && signalAborted(deliveredControl.signal)) origins.push(deliveredControl);\n    for (const control of frame.controls) {\n      if (signalAborted(control.signal) && control !== deliveredControl) origins.push(control);\n    }',
    to: '    for (const control of frame.controls) if (signalAborted(control.signal)) origins.push(control);' });
  const mutantResults = [];
  for (const mutation of mutations) {
    assert.equal(source.toString().split(mutation.from).length, 2, 'counterfactual replacement must be unique');
    const bytes = source.toString().replace(mutation.from, mutation.to);
    const altered = build(mutation.name, bytes);
    const test = altered.result.status === 0 ? runtime(`${mutation.name}-runtime`, path.join(altered.directory, 'emitted/cancellation.js'),
      path.join(fixtures, 'cohort-v1.mjs'), mutation.family === 'repair-two' ? `^${mutation.obligation} ` : undefined) : null;
    const baselinePassing = original.passed.some(name => name.startsWith(mutation.obligation + ' '));
    const behavioralFailure = Boolean(test?.failed.some(name => name.startsWith(mutation.obligation + ' ')));
    const natural = Boolean(test && test.result.signal === null && test.result.error === null);
    mutantResults.push({ ...mutation, sourceSha256: hash(bytes), buildStatus: altered.result.status,
      runtimeStatus: test?.result.status, baselinePassing, behavioralFailure,
      killed: altered.result.status === 0 && natural && baselinePassing && behavioralFailure });
  }
  json('mutants.json', mutantResults);
  assert.deepEqual(inventory(fixtures), fixtureCopiesBefore);
  json('copied-fixtures.json', { before: fixtureCopiesBefore, after: inventory(fixtures), exactOriginalControls: true });
  const summary = {
    version: 1, candidate: pins.candidate, historicalOriginalCandidate: pins.originalCandidate, historicalOriginal12: '10 pass / 2 fail (unchanged archive; not rescored or rerun)',
    original12: { isolated: { pass: original.passed, fail: original.failed, status: original.result.status },
      moved: { pass: movedOriginal.passed, fail: movedOriginal.failed, status: movedOriginal.result.status } },
    nearby4: { isolated: { pass: nearby.passed, fail: nearby.failed, status: nearby.result.status },
      moved: { pass: movedNearby.passed, fail: movedNearby.failed, status: movedNearby.result.status } },
    types: { exactPositiveBuildStatus: candidate.result.status, exactMovedPositiveStatus: movedPositive.status,
      sixMalformedDiagnostics: negativeDiagnostics, movedSameSix: true },
    mutants: { priorThreeKilled: mutantResults.filter(item => item.family === 'prior-three' && item.killed).length,
      repairTwoKilled: mutantResults.filter(item => item.family === 'repair-two' && item.killed).length },
    authorSuitesRerun: false, publicOrRuntimeIntegration: false,
    allChildrenNatural: processes.every(item => item.signal === null && item.error === null && !item.watchdogUsed),
  };
  json('summary.json', summary);
  outcome = 'evidence-collected';
  console.log(JSON.stringify({ output, original12: [original.passed.length, original.failed.length], nearby4: [nearby.passed.length, nearby.failed.length], mutants: summary.mutants }, null, 2));
} catch (error) {
  outcome = 'infrastructure-or-fixture-failure';
  json('attempt-error.json', { name: error.name, message: error.message, stack: error.stack, actual: error.actual, expected: error.expected });
  process.exitCode = 1;
  console.error(error);
} finally {
  if (compilerBefore) {
    const originalAfter = inventory(path.join(repository, 'node_modules/typescript'));
    const copiedAfter = inventory(path.join(tools, 'typescript'));
    assert.deepEqual(originalAfter, compilerBefore);
    assert.deepEqual(copiedAfter, compilerBefore);
    assert.equal(hash(readFileSync(originalNode)), originalNodeHash);
    assert.equal(hash(readFileSync(path.join(tools, 'node'))), originalNodeHash);
    json('tools-after.json', { compiler: originalAfter, copiedCompiler: copiedAfter,
      nodeOriginalSha256: hash(readFileSync(originalNode)), nodeCopiedSha256: hash(readFileSync(path.join(tools, 'node'))) });
  }
  assert.deepEqual(fixtureMembership(), before.ownFixtures, 'own fixture membership including additions unchanged');
  const historyAfter = historicalMembership();
  assert.deepEqual(historyAfter, before.history);
  if (seal) verifySeal(seal);
  json('after.json', { at: new Date().toISOString(), history: historyAfter, ownFixtures: fixtureMembership(), live: liveSnapshot(),
    note: 'live source comparison is read-only observational metadata, never compared to historical candidate or used as execution input' });
  const scratchEntries = inventory(scratch);
  json('scratch-before-removal.json', scratchEntries);
  json('attempt.json', { outcome, processes: processes.length, allNatural: processes.every(item => item.signal === null && item.error === null && !item.watchdogUsed) });
  rmSync(scratch, { recursive: true });
  json('scratch-removal.json', { enumeratedEntries: scratchEntries.length, removed: 'scratch', absent: !existsSync(scratch) });
  json('evidence-manifest.json', inventory(output));
}

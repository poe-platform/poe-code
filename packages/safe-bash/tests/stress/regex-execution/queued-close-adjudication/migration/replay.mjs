import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const adjudication = 'tests/stress/regex-execution/queued-close-adjudication';
const owned = `${adjudication}/migration`;
const registration = 'tests/commands/regex-execution/cleanup-registration';
const canonical = 'tests/commands/regex-execution/followup/messageerror.test.ts';
const client = 'src/commands/regex-execution/client.ts';
const addedName = 'idle messageerror holds capacity until retirement for an open queued session';
const changedName = 'idle messageerror retires promptly, holds capacity and close awaits cleanup';
const historical = JSON.parse(readFileSync(`${registration}/isolated-validation.json`));
const before = JSON.parse(readFileSync(`${owned}/evidence/before.json`));
const fixture = JSON.parse(readFileSync(`${owned}/evidence/fixture.json`));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path));
const writeJson = (name, value) => writeFileSync(`${owned}/evidence/${name}.json`, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function git(...args) {
  const result = spawnSync('git', args, { timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr.toString());
  return result.stdout;
}
function absent(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
const history = [...before.historical];
for (const name of ['child.mjs', 'cohort.mjs', 'walker-cases.mjs', 'REPORT.md', 'EXPECTATIONS.md']) {
  const path = `tests/stress/regex-execution/production-continuation-review/${name}`;
  const bytes = readFileSync(path);
  assert.deepEqual(bytes, git('show', `839f2d4:${path}`), path);
  history.push({ path, sha256: hash(bytes) });
}
for (const entry of history) assert.equal(hash(readFileSync(entry.path)), entry.sha256, entry.path);
assert.equal(hash(readFileSync(canonical)), fixture.updatedSha256);
assert.equal(hash(readFileSync(client)), before.client.sha256);
assert.equal(historical.base, before.approvedContract);
assert.equal(Object.keys(historical.hashes).length, 203);
assert.equal(hash(readFileSync(`${adjudication}/controls.test.ts`)), '8703a61da44228731ffaf09f0f0fef5373d507458dd4d3dcb098460b704c9cda');
const testPaths = historical.tests.command.slice(4);
assert.deepEqual(testPaths, ['executor.test.ts', 'commands.test.ts', 'followup/messageerror.test.ts',
  'continuation/glob.test.ts', 'continuation/glob-transport.test.ts', 'cleanup-registration/controls.test.ts']
  .map(name => `tests/commands/regex-execution/${name}`));
assert.equal(process.version, historical.node);
assert.equal(process.platform, historical.platform);
assert.equal(process.arch, historical.arch);
const snapshot = mkdtempSync(resolve(owned, '.replay-'));
const children = [];
const inputs = [];
const started = new Date().toISOString();
async function run(label, command) {
  const result = await new Promise(resolveResult => {
    const child = spawn(command[0], command.slice(1), { cwd: snapshot, detached: true,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '--unhandled-rejections=strict' } });
    const state = { label, command, cwd: snapshot, pid: child.pid, processGroup: child.pid,
      started: new Date().toISOString(), stdout: '', stderr: '', events: [], killed: false };
    let bytes = 0;
    const kill = reason => {
      if (state.killed) return;
      state.killed = true;
      state.killReason = reason;
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const timer = setTimeout(() => kill('exact owned process-group 120-second outer guard'), 120000);
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.on('data', chunk => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) kill('16-MiB output cap'); else state[key] += chunk; });
      stream.on('close', () => state.events.push(`${key}-close`));
    }
    child.on('error', error => { state.spawnError = String(error); });
    child.on('exit', (code, signal) => state.events.push({ exit: code, signal }));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveResult({ ...state, code, signal, pidAbsent: child.pid ? absent(child.pid) : null,
        processGroupAbsent: child.pid ? absent(-child.pid) : null, finished: new Date().toISOString() });
    });
  });
  children.push(result);
  writeJson(label, result);
  console.log(JSON.stringify({ label, code: result.code, killed: result.killed,
    pidAbsent: result.pidAbsent, processGroupAbsent: result.processGroupAbsent }));
  assert.equal(result.killed, false, label);
  assert.equal(result.pidAbsent, true, label);
  assert.equal(result.processGroupAbsent, true, label);
  assert.equal(result.code, 0, `${label}: inspect retained evidence`);
  return result;
}
function tap(stdout) {
  return [...stdout.matchAll(/^(not )?ok (\d+) - (.+)$/gm)]
    .map(match => ({ number: Number(match[2]), name: match[3], pass: !match[1] }));
}
try {
  for (const [path, sha256] of Object.entries(historical.hashes)) {
    const original = readFileSync(resolve(historical.artifact, path));
    assert.equal(hash(original), sha256, path);
    if (path.startsWith('src/') || !path.startsWith('tests/')) {
      const revision = historical.overlay.includes(path) ? before.registration : historical.base;
      assert.deepEqual(original, git('show', `${revision}:${path}`), `${revision}:${path}`);
    }
    const bytes = path === canonical ? readFileSync(canonical) : original;
    const destination = resolve(snapshot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: 'wx' });
    inputs.push({ path, historicalSha256: sha256, replaySha256: hash(bytes), changed: !bytes.equals(original) });
  }
  assert.deepEqual(inputs.filter(entry => entry.changed).map(entry => entry.path), [canonical]);
  const controlPath = `${adjudication}/controls.test.ts`;
  mkdirSync(dirname(resolve(snapshot, controlPath)), { recursive: true });
  writeFileSync(resolve(snapshot, controlPath), readFileSync(controlPath), { flag: 'wx' });
  writeJson('replay-freeze', { started, snapshot, fixtureCommit: fixture.fixtureCommit,
    liveHead: git('rev-parse', 'HEAD').toString().trim(), approvedContract: historical.base,
    registration: before.registration, sourceOverlay: historical.overlay, inputs, historical: history,
    originalTestCommand: historical.tests.command, exactTestPaths: testPaths,
    adjudicationControl: { path: controlPath, sha256: hash(readFileSync(controlPath)) },
    harnessSha256: hash(readFileSync(`${owned}/replay.mjs`)), node: process.version,
    platform: process.platform, arch: process.arch, tsx: readJson('node_modules/tsx/package.json').version,
    typescript: readJson('node_modules/typescript/package.json').version,
    statusBefore: git('status', '--short').toString(), indexBeforeSha256: hash(git('ls-files', '--stage')),
    strictUnhandled: true, outerGuardMs: 120000, outputCapBytes: 16 * 1024 * 1024,
    preservedTestIsolation: 'historical Node default process isolation; no concurrency override',
    excluded: ['four supplemental registration controls', 'original five public fixtures',
      'independent eight variants', 'all six risky probes', 'runtime acceptance'] });
  const tsc = resolve(root, 'node_modules/typescript/bin/tsc');
  await run('build', [process.execPath, tsc, '-p', 'tsconfig.build.json']);
  await run('historical-types', [process.execPath, tsc, '-p', `${registration}/tsconfig.json`]);
  await run('fixture-control-types', [process.execPath, tsc, '--noEmit', '--strict', '--target', 'ES2022',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--types', 'node', '--skipLibCheck', canonical, controlPath]);
  const cohort = await run('cohort-101', [process.execPath, ...historical.tests.command.slice(1)]);
  const controlsCommand = readJson(`${adjudication}/evidence/current-controls.json`).command;
  const controls = await run('adjudication-11', [process.execPath, ...controlsCommand.slice(1, -1), resolve(snapshot, controlPath)]);
  const originalResults = tap(historical.tests.stdout);
  const replayResults = tap(cohort.stdout);
  const mapped = replayResults.filter(result => result.name !== addedName);
  assert.equal(originalResults.length, 100);
  assert.equal(originalResults.filter(result => result.pass).length, 99);
  assert.equal(replayResults.length, 101);
  assert.deepEqual(mapped.map(result => result.name), originalResults.map(result => result.name));
  assert.equal(replayResults.filter(result => result.name === addedName).length, 1);
  assert.equal(tap(controls.stdout).length, 11);
  for (const [output, count] of [[cohort.stdout, 101], [controls.stdout, 11]]) {
    assert.match(output, new RegExp(`^# tests ${count}$`, 'm'));
    assert.match(output, new RegExp(`^# pass ${count}$`, 'm'));
    for (const field of ['fail', 'cancelled', 'skipped', 'todo']) assert.match(output, new RegExp(`^# ${field} 0$`, 'm'));
  }
  writeJson('mapping', { historical: { tests: 100, pass: 99, fail: 1, accepted: false },
    migratedMappedSubset: { tests: 100, pass: 100, modifiedExpectations: 1 },
    addedOpenControl: { tests: 1, pass: 1 }, migratedCohort: { tests: 101, pass: 101 },
    adjudication: { tests: 11, pass: 11, exactBodySha256: hash(readFileSync(controlPath)) },
    mapping: originalResults.map((original, index) => ({ historical: original, replay: mapped[index],
      expectationChanged: original.name === changedName })), added: replayResults.find(result => result.name === addedName),
    preservedHistory: { before: '1/1', registration: '0/1', current: '0/1', oldFive: '0/5', nativeProfile: '110/111' },
    riskyProbes: 0, independentVariantsRun: 0, publicFiveRerun: false, runtimeAcceptance: false });
} finally {
  const unchangedHistory = history.every(entry => hash(readFileSync(entry.path)) === entry.sha256);
  const unchangedHistoricalInputs = Object.entries(historical.hashes)
    .every(([path, sha256]) => hash(readFileSync(resolve(historical.artifact, path))) === sha256);
  const frozenClientUnchanged = hash(readFileSync(client)) === before.client.sha256;
  const fixtureUnchanged = hash(readFileSync(canonical)) === fixture.updatedSha256;
  const remaining = children.filter(child => !absent(-child.pid));
  for (const child of remaining) process.kill(-child.pid, 'SIGKILL');
  rmSync(snapshot, { recursive: true });
  writeJson('finish', { finished: new Date().toISOString(), unchangedHistory, unchangedHistoricalInputs,
    frozenClientUnchanged, fixtureUnchanged, exactSnapshotRemoved: snapshot, snapshotAbsent: !existsSync(snapshot),
    unexpectedRemainingGroups: remaining.map(child => child.pid),
    children: children.map(({ label, pid, code, signal, killed, pidAbsent, processGroupAbsent, events }) =>
      ({ label, pid, code, signal, killed, pidAbsent, processGroupAbsent, events })),
    statusAfter: git('status', '--short').toString(), indexAfterSha256: hash(git('ls-files', '--stage')),
    strictUnhandled: true, riskyProbes: 0, publicFiveRerun: false, runtimeAcceptance: false });
  assert.equal(unchangedHistory, true);
  assert.equal(unchangedHistoricalInputs, true);
  assert.equal(frozenClientUnchanged, true);
  assert.equal(fixtureUnchanged, true);
  assert.equal(remaining.length, 0);
}

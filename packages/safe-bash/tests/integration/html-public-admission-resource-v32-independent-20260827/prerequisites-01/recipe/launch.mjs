import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { recipe, scope, raw, read, save, fileHash, inventory, authenticateRecipe, authenticateProtected, probe, errorRecord } from './common.mjs';

const commit = process.argv[2];
assert.match(commit ?? '', /^[a-f0-9]{40}$/u);
const bindings = read(join(recipe, 'BINDINGS.json'));
assert.equal(fs.realpathSync(process.execPath), bindings.tools.node.realpath);
for (const tool of Object.values(bindings.tools)) {
  assert.equal(fs.realpathSync(tool.path), tool.realpath);
  assert.equal(fileHash(tool.path), tool.sha256);
}
const recipeProof = authenticateRecipe(commit);
save(join(scope, 'INVOCATION-LOCK.json'), { at: new Date().toISOString(), invocation: 1, retry: false, recipeProof });
fs.mkdirSync(raw);
fs.mkdirSync(join(raw, 'tmp'));
const result = { started: new Date().toISOString(), invocation: 1, retries: 0, recipe: recipeProof, signals: [], errors: [], realResourceCasesReplayed: 0 };
let child, closed = false, deadline, escalation;
function records(prefix) {
  return fs.readdirSync(raw).filter(name => name.startsWith(prefix) && name.endsWith('.jsonl')).flatMap(name => fs.readFileSync(join(raw, name), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
}
function emergency(signal) {
  const events = records('process-');
  const active = events.filter(row => row.type === 'spawn' && row.detached && !events.some(later => later.type === 'close' && later.childPid === row.childPid));
  for (const pid of [...active.map(row => row.childPid), ...(!closed && child?.pid ? [child.pid] : [])]) {
    try { process.kill(-pid, signal); result.signals.push({ pid, signal, accepted: true }); }
    catch (error) { result.signals.push({ pid, signal, error: errorRecord(error) }); }
  }
}
try {
  save(join(raw, 'PRE.json'), await authenticateProtected());
  const stdout = fs.openSync(join(raw, 'coordinator.stdout.data'), 'wx'), stderr = fs.openSync(join(raw, 'coordinator.stderr.data'), 'wx');
  const args = ['--import', join(recipe, 'preload.mjs'), join(recipe, 'run.mjs')];
  save(join(raw, 'START.json'), { at: new Date().toISOString(), executable: bindings.tools.node, args, wholePrerequisiteWatchdogMs: 300000, unchangedCaseDeadlineMs: 45000, unchangedCleanupGraceMs: 3000 });
  child = spawn(bindings.tools.node.path, args, { cwd: scope, env: { PATH: '/usr/bin:/bin', HOME: join(raw, 'tmp'), TMPDIR: join(raw, 'tmp'), LC_ALL: 'C' }, detached: true, stdio: ['ignore', stdout, stderr] });
  result.pid = child.pid;
  child.once('error', error => result.errors.push(errorRecord(error)));
  child.once('exit', (code, signal) => { result.exit = { code, signal }; });
  deadline = setTimeout(() => {
    result.errors.push({ code: 'PREREQUISITE_DEADLINE', message: 'No retry; emergency cleanup only' });
    emergency('SIGTERM'); escalation = setTimeout(() => emergency('SIGKILL'), 3000);
  }, 300000);
  result.close = await new Promise(resolveClose => child.once('close', (code, signal) => { closed = true; resolveClose({ code, signal }); }));
  clearTimeout(deadline); clearTimeout(escalation);
  fs.fsyncSync(stdout); fs.fsyncSync(stderr); fs.closeSync(stdout); fs.closeSync(stderr);
  save(join(raw, 'COORDINATOR-CLOSE.json'), { pid: child.pid, exit: result.exit, close: result.close });
  const events = records('process-'), loads = records('loads-');
  const spawns = events.filter(row => row.type === 'spawn');
  result.processes = spawns.map(row => ({ ...row, exit: events.find(event => event.type === 'exit' && event.childPid === row.childPid), close: events.find(event => event.type === 'close' && event.childPid === row.childPid), signals: events.filter(event => event.type === 'signal' && event.childPid === row.childPid) }));
  result.synchronous = { returned: events.filter(row => row.type === 'exec-sync-return').length, spawnSyncClosed: events.filter(row => row.type === 'sync-close').length, failures: events.filter(row => row.type === 'exec-sync-error' || (row.type === 'sync-close' && (row.status !== 0 || row.error))) };
  result.probe = probe([child.pid, ...spawns.map(row => row.childPid)], [child.pid, ...spawns.filter(row => row.detached).map(row => row.childPid)]);
  result.loads = loads;
  save(join(raw, 'FINAL-PROBE.json'), result.probe);
  result.post = await authenticateProtected();
  save(join(raw, 'POST.json'), result.post);
  result.summary = read(join(raw, 'SUMMARY.json'));
  assert.equal(result.close.code, 0); assert.equal(result.close.signal, null);
  assert.equal(result.summary.expected, 75); assert.equal(result.summary.unexpected, 0); assert.equal(result.summary.unexecuted, 0);
  assert.equal(result.signals.length, 0);
  assert.equal(spawns.length, 9);
  assert.ok(result.processes.every(row => row.exit && row.close));
  assert.ok(result.probe.pids.every(row => row.state === 'absent'));
  assert.ok(result.probe.groups.every(row => row.members.length === 0));
  assert.equal(result.synchronous.failures.length, 0);
  const required = ['synthetic-controls.mjs', 'terminal-predicate.mjs', 'forwarding-controls.mjs', 'aggregation.mjs', 'forwarding-worker.mjs'];
  for (const name of required) assert.ok(loads.some(row => row.url.endsWith(`/recipe/${name}`)), `ACTUAL_LOAD:${name}`);
  assert.ok(loads.some(row => row.url.endsWith('/read-only-verifier.mjs')));
  assert.equal(loads.filter(row => row.url.endsWith('/recipe/forwarding-worker.mjs')).length, 8);
  assert.ok(!loads.some(row => /\/(worker|stream-fixture|producer-observer|coordinator)\.mjs$/u.test(row.url)), 'REAL_RESOURCE_REPLAY_FORBIDDEN');
  const snapshot = inventory(raw);
  assert.ok(Object.values(snapshot.files).every(row => row.bytes <= 16 * 1024 ** 2));
  assert.ok(Object.values(snapshot.files).reduce((total, row) => total + row.bytes, 0) <= 128 * 1024 ** 2);
  result.recipeAfter = authenticateRecipe(commit);
} catch (error) { result.errors.push(errorRecord(error)); }
finally { clearTimeout(deadline); clearTimeout(escalation); }
result.finished = new Date().toISOString();
result.status = result.errors.length ? 'HOLD' : 'PREREQUISITES-75-PASS';
save(join(scope, 'RESULT.json'), result);
console.log(JSON.stringify({ status: result.status, expected: result.summary?.expected ?? 0, unexpected: result.summary?.unexpected ?? 0, unexecuted: result.summary?.unexecuted ?? 75, processes: result.processes?.length, errors: result.errors, realResourceCasesReplayed: 0 }));
process.exitCode = result.errors.length ? 1 : 0;

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync, writeSync, fsyncSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { owned, repository, freeze, manifestSha, authenticate, inventory, readJson, fileHash, git } from './authenticate.mjs';
import { adapted } from './adapt.mjs';

function save(path, value) {
  const descriptor = openSync(path, 'wx');
  try { writeSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}
const recipe = join(owned, 'recipe');
const recipeManifest = readJson(join(recipe, 'MANIFEST.json'));
const recipeCommit = process.argv[2];
assert.match(recipeCommit, /^[a-f0-9]{40}$/u);
const recipeRelative = relative(repository, recipe);
assert.equal(git(['show', `${recipeCommit}:${recipeRelative}/MANIFEST.json`]).toString(), readFileSync(join(recipe, 'MANIFEST.json'), 'utf8'));
const actual = inventory(recipe);
assert.deepEqual(Object.keys(actual.files).sort(), [...Object.keys(recipeManifest.files), 'MANIFEST.json'].sort());
for (const [path, identity] of Object.entries(recipeManifest.files)) {
  assert.deepEqual(actual.files[path], identity, path);
  assert.equal(git(['show', `${recipeCommit}:${recipeRelative}/${path}`]).toString(), readFileSync(join(recipe, path), 'utf8'));
}
assert.equal(readFileSync(join(recipe, 'coordinator.mjs'), 'utf8'), adapted().text);
const lock = openSync(join(owned, 'INVOCATION-LOCK.json'), 'wx');
writeSync(lock, `${JSON.stringify({ recipeCommit, at: new Date().toISOString(), actualInvocationsAllowed: 1, retries: 0 })}\n`);
fsyncSync(lock); closeSync(lock);
mkdirSync(join(owned, 'raw'));
mkdirSync(join(owned, 'raw/observations'));
mkdirSync(join(owned, 'raw/tmp'));
const pre = await authenticate();
save(join(owned, 'raw/PRE-AUTH.json'), pre);
const frozenPre = readJson(join(recipe, 'PREFLIGHT.json'));
assert.deepEqual(pre.tools, frozenPre.tools);
const node = pre.tools.node.path;
const args = ['--import', join(recipe, 'observe.mjs'), join(recipe, 'coordinator.mjs'), freeze, manifestSha, join(owned, 'raw/execution-01')];
const env = { PATH: `${dirname(node)}:/usr/bin:/bin`, HOME: join(owned, 'raw/tmp'), TMPDIR: join(owned, 'raw/tmp'), LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
save(join(owned, 'raw/LAUNCH-START.json'), { at: new Date().toISOString(), recipeCommit, recipeManifestSha256: fileHash(join(recipe, 'MANIFEST.json')), executable: node, args, cwd: repository, env, cases: pre.amendment.policy.controls, retries: 0 });
const stdout = openSync(join(owned, 'raw/stdout.data'), 'wx');
const stderr = openSync(join(owned, 'raw/stderr.data'), 'wx');
const child = spawn(node, args, { cwd: repository, env, detached: true, stdio: ['ignore', stdout, stderr] });
const events = [];
child.once('error', error => events.push({ type: 'error', code: error.code, message: error.message }));
child.once('exit', (code, signal) => events.push({ type: 'exit', code, signal, at: new Date().toISOString() }));
const terminal = await new Promise(resolve => child.once('close', (code, signal) => { events.push({ type: 'close', code, signal, at: new Date().toISOString() }); resolve({ code, signal }); }));
fsyncSync(stdout); fsyncSync(stderr); closeSync(stdout); closeSync(stderr);
save(join(owned, 'raw/LAUNCH-RESULT.json'), { at: new Date().toISOString(), pid: child.pid, ...terminal, events });
const observed = inventory(join(owned, 'raw/observations'));
const rows = Object.keys(observed.files).flatMap(path => readFileSync(join(owned, 'raw/observations', path), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
const subjects = [...new Set([child.pid, ...rows.filter(row => row.type === 'spawn').map(row => row.childPid)])];
const groups = [child.pid, ...rows.filter(row => row.type === 'spawn' && row.detached).map(row => row.childPid)];
const table = spawnSync(pre.tools.ps.path, ['-axo', 'pid=,ppid=,pgid=,stat=,command='], { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 ** 2, env });
const members = table.status === 0 && !table.error ? table.stdout.split('\n').filter(line => groups.includes(Number(line.trim().split(/\s+/u)[2]))) : null;
const pidStates = subjects.map(pid => { try { process.kill(pid, 0); return { pid, state: 'live-or-zombie' }; } catch (error) { return { pid, state: error.code === 'ESRCH' ? 'absent' : 'unknown', error: error.code }; } });
save(join(owned, 'raw/FINAL-PROCESS-PROBE.json'), { at: new Date().toISOString(), subjects, groups, members, pidStates, ps: { status: table.status, signal: table.signal, error: table.error?.message ?? null }, scope: 'owned coordinator and five worker process groups; one-time absence observations, not PID leases' });
const post = await authenticate();
save(join(owned, 'raw/POST-AUTH.json'), post);
assert.deepEqual(post.tools, pre.tools);
assert.deepEqual(members, []);
assert.ok(pidStates.every(row => row.state === 'absent'));
for (const row of rows.filter(row => row.type === 'spawn')) {
  assert.ok(rows.some(event => event.pid === row.pid && event.type === 'child-exit' && event.childPid === row.childPid));
  assert.ok(rows.some(event => event.pid === row.pid && event.type === 'child-close' && event.childPid === row.childPid));
}
save(join(owned, 'raw/SETTLED.json'), { at: new Date().toISOString(), coordinatorCloseAwaited: true, spawnedSubjects: subjects.length, ownedGroupsEmpty: true, allObservedChildrenExitedAndClosed: true, terminal });
process.exitCode = terminal.code === 0 && terminal.signal === null ? 0 : 1;

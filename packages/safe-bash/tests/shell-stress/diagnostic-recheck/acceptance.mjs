import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { cases as nulCases, names } from './nul-cases.mjs';
import { owned, root, primary, env, save, sha256, runChild } from './support.mjs';

const revision = 'c116d637aa82e4b075460fc07088a5703a10e7b4';
const ready = await readFile('/tmp/safe-bash-diagnostic-fix-author-ready.txt', 'utf8');
assert.ok(ready.includes(revision)); assert.match(ready, /SOURCE WRITE LEASE RELINQUISHED/u);
const baseline = JSON.parse(await readFile(resolve(owned, 'original-baseline.json')));
const priorNul = JSON.parse(await readFile(resolve(owned, 'nul-baseline.json')));
const nativeNul = JSON.parse(await readFile(resolve(owned, 'nul-native-frozen.json')));
const originalNative = JSON.parse(await readFile('benchmarks/shell-stress/diagnostic-profiles/native-baseline.json'));
const profiles = nativeNul.profiles;
const anchors = {};
for (const path of Object.keys(baseline.anchors)) anchors[path] = sha256(execFileSync('git', ['show', `${revision}:${path}`]));
assert.equal(anchors['src/shell/runtime.ts'], 'f307642e52c3bfeb5df64057fb26af6645135bb5bdc307f399de6ce1541c0ddb');
assert.equal(anchors['src/shell/parser.ts'], 'f8a76103ccc3e0f981bdb8cf391f48a8864dbf895c39e459d5f5da7b6ec77b0c');
const frozen = { ...baseline.frozenInputs };
for (const name of ['BASELINE.md', 'capture.mjs', 'findings.json', 'frozen-cases.json', 'nul-baseline.json', 'nul-cases.mjs', 'nul-native-frozen.json', 'original-baseline.json', 'support.mjs', 'trace.mjs']) {
  const path = relative(root, resolve(owned, name)); frozen[path] = sha256(execFileSync('git', ['show', `7e9a15d:${path}`], { maxBuffer: 16e6 }));
}
for (const profile of profiles) assert.equal(sha256(await readFile(profile.executable)), profile.sha256);
async function check() { for (const [path, hash] of Object.entries({ ...anchors, ...frozen })) assert.equal(sha256(await readFile(path)), hash, path); }
await check();
async function inventory(extra = []) {
  const values = {};
  async function visit(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.name.startsWith('.')) continue; const path = `${directory}/${entry.name}`; if (entry.isDirectory()) await visit(path); else if (/\.(?:[cm]?ts|tsx|mjs|json)$/u.test(path)) values[path] = sha256(await readFile(path)); } }
  await visit('src'); await visit('tests');
  for (const path of new Set([...Object.keys(frozen), 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'benchmarks/tsconfig.json', 'tests/shell/diagnostic-context-report.md', ...extra])) values[path] = await readFile(path).then(sha256).catch(() => null);
  return Object.fromEntries(Object.entries(values).sort());
}
const manifests = {}; const pids = new Set(); const records = []; const nativeFresh = []; const nulRows = [];
const store = map => { const sorted = Object.fromEntries(Object.entries(map).sort()); const hash = sha256(JSON.stringify(sorted)); manifests[hash] = sorted; return hash; };
const temporary = await mkdtemp(resolve(tmpdir(), 'safe-bash-diagnostic-acceptance-'));
const started = new Date().toISOString();
let stopped;
function pairedRows(processes, label) {
  const recent = new Map(); const rows = [];
  for (const child of processes) {
    if (profiles.some(profile => profile.executable === child.executable) && child.args.includes('-c')) recent.set(child.parent, child);
    if (child.executable !== process.execPath || !child.stdin) continue;
    let request; try { request = JSON.parse(Buffer.from(child.stdin, 'base64').toString()); } catch { continue; }
    if (request.kind !== 'script') continue;
    const native = recent.get(child.parent); assert.ok(native, request.fixture.name);
    assert.equal(native.args[native.args.indexOf('-c') + 1], request.fixture.script);
    const actual = JSON.parse(Buffer.from(child.stdout, 'base64').toString());
    const expected = { stdout: Buffer.from(native.stdout, 'base64').toString(), stderr: Buffer.from(native.stderr, 'base64').toString(), stdoutBase64: native.stdout, stderrBase64: native.stderr, exitCode: native.status, files: native.files };
    const profile = profiles.find(profile => profile.executable === native.executable); const sourceName = native.args[native.args.indexOf('-c') + 2];
    const frozenRow = originalNative.captures.find(capture => capture.profile === profile.name && capture.argv0 === sourceName && capture.repetition === 1).rows.find(row => isDeepStrictEqual(row.fixture, request.fixture));
    const previous = baseline.records.find(record => record.label === label).rows.find(row => row.fixture.name === request.fixture.name);
    rows.push({ fixture: request.fixture, nativePid: native.pid, virtualPid: child.pid, profile: profile.name, sourceName, native: expected, actual, exact: isDeepStrictEqual(expected, actual), nativeFrozenEqual: isDeepStrictEqual(expected, frozenRow.observation), unchangedActual: isDeepStrictEqual(actual, previous.actual), oldNine: previous.oldNine });
  }
  assert.equal(rows.length, 88); return rows;
}
async function phase(label, args, options = {}) {
  await check(); const trace = resolve(temporary, label + '.jsonl');
  const childEnv = { ...env, ...options.env, DIAGNOSTIC_RECHECK_TRACE: trace };
  const listed = options.compiler ? await runChild(process.execPath, [...args, '--listFilesOnly'], { env: childEnv, deadline: 60000 }) : undefined;
  if (listed) { pids.add(listed.pid); assert.equal(listed.status, 0, 'Compiler input enumeration'); }
  const compilerPaths = listed ? Buffer.from(listed.stdout, 'base64').toString().split('\n').filter(path => path.startsWith('/') && /\.[cm]?tsx?$/u.test(path)).map(path => relative(root, path)) : [];
  const before = await inventory(compilerPaths);
  const runArgs = ['--import', resolve(owned, 'trace.mjs'), ...args, ...(options.compiler ? ['--listFiles'] : [])];
  const run = await runChild(process.execPath, runArgs, { env: childEnv, stdin: options.stdin, deadline: options.deadline ?? 120000 }); pids.add(run.pid);
  const after = await inventory(compilerPaths); const events = (await readFile(trace, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const loads = events.filter(row => row.type === 'load'); const processes = events.filter(row => row.type === 'process');
  for (const row of events) if (row.pid) pids.add(row.pid);
  const loaded = Object.fromEntries(loads.map(row => [relative(root, row.path), row.hash]));
  const mismatches = loads.filter(row => before[relative(root, row.path)] !== row.hash || after[relative(root, row.path)] !== row.hash);
  const text = Buffer.from(run.stdout, 'base64').toString();
  const actualInputs = options.compiler ? [...new Set(text.split('\n').filter(path => path.startsWith('/') && /\.[cm]?tsx?$/u.test(path)).map(path => relative(root, path)))].sort() : Object.keys(loaded).sort();
  const changed = actualInputs.filter(path => !before[path] || before[path] !== after[path]);
  const sourceDrift = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => path.startsWith('src/') && before[path] !== after[path]);
  const counts = Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  const byPid = {}; for (const load of loads) (byPid[load.pid] ??= {})[relative(root, load.path)] = load.hash;
  const record = { label, args: runArgs, env: childEnv, run, listed, counts, before: store(before), after: store(after), loaded: store(loaded), perPidLoads: Object.fromEntries(Object.entries(byPid).map(([pid, map]) => [pid, store(map)])), actualInputs, compilerPaths, mismatches, changed, sourceDrift, unimportedDrift: sourceDrift.filter(path => !loaded[path]), guarded: actualInputs.length > 0 && !mismatches.length && !changed.length && !run.timedOut && !run.overflow && !run.groupAlive, processes };
  if (options.original) record.rows = pairedRows(processes, label);
  records.push(record); await check();
  console.log(JSON.stringify({ label, status: run.status, counts, guarded: record.guarded, sourceDrift, changed, inputs: actualInputs.length, ...(record.rows ? { exact: record.rows.filter(row => row.exact).length, total: 88, nativeDrift: record.rows.filter(row => !row.nativeFrozenEqual).length } : {}) }));
  assert.ok(!run.timedOut && !run.overflow && !run.groupAlive, 'Bounded phase termination');
  return record;
}
try {
  for (const profile of profiles) for (const name of names) for (const fixture of nulCases) {
    const cwd = await mkdtemp(resolve(temporary, 'native-nul-')); const nativeEnv = { ...env, HOME: cwd, TMPDIR: cwd };
    try {
      const args = ['--noprofile', '--norc', '-c', fixture.script, name]; const run = await runChild(profile.executable, args, { cwd, env: nativeEnv, deadline: 2000 }); pids.add(run.pid);
      const files = await readdir(cwd); assert.deepEqual(files, []);
      const previous = nativeNul.nativeCaptures.find(row => row.profile === profile.name && row.name === name && row.fixture === fixture.name);
      nativeFresh.push({ profile: profile.name, fixture: fixture.name, name, executable: profile.executable, argv0: profile.executable, args, cwd, env: nativeEnv, run, files: {}, frozenEqual: run.status === previous.run.status && run.stdout === previous.run.stdout && run.stderr === previous.run.stderr && !run.timedOut && !run.overflow && !run.groupAlive });
    } finally { await rm(cwd, { recursive: true, force: true }); }
  }
  assert.ok(nativeFresh.every(row => row.frozenEqual), 'Native facts changed; stop rather than replace oracle');
  for (const name of names) for (const fixture of nulCases) {
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    const script = name === 'shell' ? fixture.script : `bash -c ${quote(fixture.script)} ${quote(name)}`;
    const request = { kind: 'script', fixture: { name: fixture.name, script } };
    assert.deepEqual(request, priorNul.rows.find(row => row.name === name && row.fixture === fixture.name).request);
    const record = await phase(`nul-${name}-${fixture.name}`, ['--import', 'tsx', 'tests/shell-stress/virtual-child.ts'], { stdin: JSON.stringify(request), deadline: 6000 });
    const actual = JSON.parse(Buffer.from(record.run.stdout, 'base64').toString());
    const comparisons = nativeNul.nativeCaptures.filter(row => row.name === name && row.fixture === fixture.name).map(row => ({ profile: row.profile, exact: row.run.stdout === actual.stdoutBase64 && row.run.stderr === actual.stderrBase64 && row.run.status === actual.exitCode && isDeepStrictEqual(row.files, actual.files), expected: { stdoutBase64: row.run.stdout, stderrBase64: row.run.stderr, exitCode: row.run.status, files: row.files } }));
    nulRows.push({ fixture: fixture.name, name, request, actual, comparisons, guarded: record.guarded, before: priorNul.rows.find(row => row.name === name && row.fixture === fixture.name).actual });
    assert.ok(comparisons.find(row => row.profile === 'primary-5.3').exact, `Frozen primary NUL still fails: ${name}/${fixture.name}`);
  }
  const tests = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1'];
  for (const [label, profileName, override, files] of [
    ['original-historical', 'historical-3.2', undefined, ['tests/shell-stress/differential.test.ts', 'tests/shell-stress/current-gaps/compatibility.test.ts']],
    ['original-primary', 'primary-5.3', primary, ['tests/shell-stress/differential.test.ts', 'tests/shell-stress/current-gaps/compatibility.test.ts']],
    ['profile-primary', 'primary-5.3', undefined, ['tests/shell-stress/diagnostic-profiles/compatibility.test.ts']],
    ['profile-historical', 'historical-3.2', undefined, ['tests/shell-stress/diagnostic-profiles/compatibility.test.ts']],
  ]) {
    const record = await phase(label, [...tests, ...files], { original: true, env: { VIRTUAL_BASH_DIAGNOSTIC_PROFILE: profileName, ...(override ? { DIAGNOSTIC_NATIVE_OVERRIDE: override } : {}) } });
    assert.ok(record.rows.every(row => row.unchangedActual), `Original diagnostic behavior regressed: ${label}`);
  }
  await phase('author25-both-profiles', ['--unhandled-rejections=strict', '--import', 'tsx', 'tests/shell/diagnostic-context-native.ts', 'compare']);
  for (const [label, files] of [
    ['author26', ['tests/shell/diagnostic-context.test.ts', 'tests/shell/diagnostic-context-bounds.test.ts']],
    ['diagnostic-parser171', ['substitution-nul', 'diagnostic-regressions', 'fatal-diagnostics', 'fs-error-diagnostics', 'parser-regressions', 'descriptor-moves', 'descriptor-inheritance', 'ansi-words', 'input-units'].map(name => `tests/shell/${name}.test.ts`)],
    ['source-eval134', ['source', 'source-host', 'eval', 'eval-host', 'diagnostics'].map(name => `tests/shell/source-dot-eval-${name}.test.ts`)],
    ['current-shell43', ['tests/shell-stress/current-shell/current-shell.test.ts']],
  ]) { const record = await phase(label, [...tests, ...files]); assert.equal(record.run.status, 0, `Affected suite failure ${label}: stop for root routing`); }
  for (const [label, args] of [['global', []], ['build', ['-p', 'tsconfig.build.json']], ['benchmark', ['-p', 'benchmarks/tsconfig.json']]]) await phase(label, ['node_modules/typescript/bin/tsc', ...args, '--noEmit'], { compiler: true });
} catch (error) { stopped = { name: error.name, message: error.message, stack: error.stack }; console.error(error.message); process.exitCode = 1; }
finally {
  const alive = []; for (const pid of pids) for (const target of [pid, -pid]) { try { process.kill(target, 0); alive.push(target); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  const finalInventory = await inventory(); const endpoint = records.map(record => ({ label: record.label, changed: record.actualInputs.filter(path => finalInventory[path] !== undefined && finalInventory[path] !== manifests[record.after][path]) }));
  save('acceptance-c116d637.json', { started, finished: new Date().toISOString(), revision, ready, anchors, frozen, profiles, manifests, records, nativeFresh, nulRows, stopped, endpoint, checkedPids: pids.size, alive });
  await rm(temporary, { recursive: true, force: true });
}

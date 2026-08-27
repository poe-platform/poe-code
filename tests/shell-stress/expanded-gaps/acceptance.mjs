import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { owned, root, env, save, sha256, runChild } from './harness.mjs';
const ready = await readFile('/tmp/safe-bash-expanded-gaps-author-ready.txt', 'utf8');
const revision = '0f5dbb3b5c65f773eada40876fa18098c36a5fbd';
assert.ok(ready.includes(revision)); assert.match(ready, /SOURCE WRITE LEASE RELINQUISHED/u);
const anchors = {
  'src/shell/runtime.ts': 'fc8b4fc043068c2b8ad5efbb0a7100720424e307f54c8574bdf901a99aecd29f',
  'src/shell/parser.ts': '28492059750ba7f11fad563dfc03dba049f232b3f2212186cf3553e4559ae905',
  'src/shell/shell.ts': '4ac91162195c150848793c92b8b1e90f15a36e67b5ae8a2652fe7ed9dcf4fb5e',
  'src/shell/types.ts': 'fc4133f1fb41283b0586aa7597c766d393d4f91067b613f4777e5adbef230a6d',
};
async function checkReady() { for (const [path, expected] of Object.entries(anchors)) { assert.equal(sha256(await readFile(path)), expected, path); assert.equal(sha256(execFileSync('git', ['show', `${revision}:${path}`])), expected, `committed ${path}`); } }
await checkReady();
const frozen = {};
for (const name of ['cases.mjs', 'native-frozen.json', 'product.mjs', 'replay.mjs', 'harness.mjs', 'pre-ready-current.json', 'pre-ready-harness-recovery.json']) {
  const path = relative(root, resolve(owned, name)); const expected = sha256(execFileSync('git', ['show', `70065f1:${path}`], { maxBuffer: 8e6 }));
  assert.equal(sha256(await readFile(path)), expected); frozen[path] = expected;
}
const fixed = [];
async function list(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.name.startsWith('.')) continue; const path = `${directory}/${entry.name}`; if (entry.isDirectory()) await list(path); else if (/\.(?:[cm]?ts|tsx|mjs|json)$/u.test(path)) fixed.push(path); } }
await list('src'); await list('tests');
fixed.push('package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'benchmarks/tsconfig.json');
const inputs = [...new Set(fixed)].sort(); const manifests = {}; const records = []; const pids = new Set();
const snapshot = async paths => Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(path).then(sha256).catch(() => null)])));
const store = values => { const sorted = Object.fromEntries(Object.entries(values).sort()); const hash = sha256(JSON.stringify(sorted)); manifests[hash] = sorted; return hash; };
const temporary = await mkdtemp(resolve(tmpdir(), 'safe-bash-expanded-acceptance-'));
const patchDirectory = dirname(execFileSync('/usr/bin/which', ['apply_patch'], { encoding: 'utf8' }).trim());
const started = new Date().toISOString();
const tests = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1'];
const originalOnly = process.argv[2] === 'original';
const commands = originalOnly ? [['original72', [...tests, 'tests/shell-stress/invocation-modes/holdout.test.ts']]] : [
  ['independent46', [resolve(owned, 'replay.mjs'), 'ready-0f5dbb3.json']],
  ['author58', [...tests, ...['fallback', 'fallback-host', 'env', 'env-host', 'parameter', 'bounds'].map(name => `tests/shell/expanded-gaps-${name}.test.ts`)]],
  ['current-shell43', [...tests, 'tests/shell-stress/current-shell/current-shell.test.ts']],
  ['env-author31', [...tests, 'tests/shell/env-replacement.test.ts', 'tests/shell/env-replacement-bounds.test.ts']],
  ['source-eval86', [...tests, ...['source', 'source-host', 'eval', 'eval-host'].map(name => `tests/shell/source-dot-eval-${name}.test.ts`)]],
  ['author132', [...tests, 'tests/shell/invocation-modes.test.ts']],
  ['prior211', [...tests, ...['discovery', 'read', 'sh'].map(name => `tests/shell/invocation-closure-${name}.test.ts`)]],
  ...[['global', []], ['build', ['-p', 'tsconfig.build.json']], ['benchmark', ['-p', 'benchmarks/tsconfig.json']]].map(([name, args]) => [name, ['node_modules/typescript/bin/tsc', ...args, '--noEmit'], true]),
];
try {
  for (const [label, args, compiler] of commands) {
    await checkReady(); const trace = resolve(temporary, `${label}.jsonl`);
    const childEnv = { ...env, PATH: `${patchDirectory}:/usr/bin:/bin`, GAPS_ACCEPTANCE_TRACE: trace };
    const listed = compiler ? await runChild(process.execPath, [...args, '--listFilesOnly'], { env: childEnv, deadline: 60000 }) : undefined;
    if (listed) { pids.add(listed.pid); assert.equal(listed.status, 0); }
    const compilerPaths = listed ? Buffer.from(listed.stdout, 'base64').toString().split('\n').filter(path => path.startsWith('/') && /\.[cm]?tsx?$/u.test(path)).map(path => relative(root, path)) : [];
    const paths = [...new Set([...inputs, ...compilerPaths])]; const before = await snapshot(paths);
    const run = await runChild(process.execPath, ['--import', resolve(owned, 'acceptance-trace.mjs'), ...args, ...(compiler ? ['--listFiles'] : [])], { env: childEnv, deadline: 120000 }); pids.add(run.pid);
    const after = await snapshot(paths); const loads = (await readFile(trace, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    for (const entry of loads) pids.add(entry.pid);
    const stdout = Buffer.from(run.stdout, 'base64').toString();
    const actual = [...new Set(compiler ? stdout.split('\n').filter(path => path.startsWith('/') && /\.[cm]?tsx?$/u.test(path)).map(path => relative(root, path)) : loads.map(entry => relative(root, entry.path)))].sort();
    const mismatches = loads.filter(entry => before[relative(root, entry.path)] !== entry.hash || after[relative(root, entry.path)] !== entry.hash);
    const changed = actual.filter(path => !before[path] || before[path] !== after[path]); const drift = paths.filter(path => before[path] !== after[path]);
    const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
    const record = { label, args, run, listed, counts, before: store(before), after: store(after), loaded: store(Object.fromEntries(loads.map(entry => [relative(root, entry.path), entry.hash]))), actual, compilerPaths, mismatches, changed, drift, guarded: actual.length > 0 && !mismatches.length && !changed.length };
    records.push(record); console.log(JSON.stringify({ label, status: run.status, counts, guarded: record.guarded, actual: actual.length, changed, drift }));
    assert.ok(!run.timedOut && !run.overflow && !run.groupAlive, label); await checkReady();
  }
  const current = await snapshot(inputs); const visible = [];
  for (const pid of pids) for (const target of [pid, -pid]) { try { process.kill(target, 0); visible.push(target); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  const endpointDrift = records.map(record => ({ label: record.label, paths: record.actual.filter(path => current[path] !== undefined && current[path] !== manifests[record.after][path]) }));
  for (const [path, expected] of Object.entries(frozen)) assert.equal(sha256(await readFile(path)), expected);
  save(originalOnly ? 'ready-original72.json' : 'acceptance-0f5dbb3.json', { started, finished: new Date().toISOString(), ready, revision, anchors, frozen, inputs, manifests, records, endpointDrift, checkedPids: pids.size, visible });
} finally { await rm(temporary, { recursive: true, force: true }); }

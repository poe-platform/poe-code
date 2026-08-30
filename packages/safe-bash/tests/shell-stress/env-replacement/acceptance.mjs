import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { owned, root, save, sha256, runChild, env } from './harness.mjs';

const ready = await readFile('/tmp/safe-bash-env-replacement-author-ready.txt', 'utf8');
assert.match(ready, /lease relinquished/u);
const revision = '954f2302e4b2f42f90cb5ffd5670d1936f47390c';
const core = '84fc74259706ee8d7a39680f098aa61d43b0085e';
assert.ok(ready.includes(revision) && ready.includes(core));
const anchors = {
  'src/shell/runtime.ts': '7aaaaff3ebc18c65556036878e48a4977b55bc2689adfc647c20be663f3cdd42',
  'src/shell/types.ts': 'fc4133f1fb41283b0586aa7597c766d393d4f91067b613f4777e5adbef230a6d',
  'src/shell/shell.ts': '4ac91162195c150848793c92b8b1e90f15a36e67b5ae8a2652fe7ed9dcf4fb5e',
  'src/contracts/command.ts': '1ec2f2907eb123ea366623bda293249a62bad6886a63bebb957930df0d414ffa',
  'src/commands/execution.ts': '1d084ab203dc59a510e39e5c71743b755ba9bdb5d4b018658398ed96c3dff700',
};
async function checkAnchors() {
  for (const [path, hash] of Object.entries(anchors)) {
    assert.equal(sha256(await readFile(path)), hash, `Current READY ${path}`);
    assert.equal(sha256(execFileSync('git', ['show', `${revision}:${path}`])), hash, `Committed READY ${path}`);
  }
  execFileSync('git', ['merge-base', '--is-ancestor', core, revision]);
}
await checkAnchors();
const frozen = {};
for (const name of ['cases.mjs', 'native-frozen.json', 'product.mjs', 'replay.mjs', 'harness.mjs', 'pre-ready-red.json', 'pre-ready-corrected.json']) {
  const path = relative(root, resolve(owned, name)); const expected = sha256(execFileSync('git', ['show', `a460c28:${path}`], { maxBuffer: 8 * 1024 * 1024 }));
  assert.equal(sha256(await readFile(path)), expected, path); frozen[path] = expected;
}
const fixedPaths = [];
async function list(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await list(path);
    else if (/\.(?:ts|mjs)$/u.test(path) || directory === 'tests/shell' && path.endsWith('.json')) fixedPaths.push(path);
  }
}
await list('src'); await list('tests');
fixedPaths.push('package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'benchmarks/tsconfig.json', ...Object.keys(frozen));
const inputs = [...new Set(fixedPaths)].sort();
const manifests = {}; const records = []; const pids = new Set();
const store = values => { const sorted = Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))); const hash = sha256(JSON.stringify(sorted)); manifests[hash] = sorted; return hash; };
const snapshot = async paths => Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(path).then(sha256).catch(() => null)])));
const temporary = await mkdtemp(resolve(owned, '.acceptance-'));
const patchDirectory = dirname(execFileSync('/usr/bin/which', ['apply_patch'], { encoding: 'utf8' }).trim());
const started = new Date().toISOString();
try {
  const tests = ['--unhandled-rejections=strict', '--import', 'tsx', '--import', './tests/shell-stress/invocation-modes/trace.mjs', '--test', '--test-concurrency=1'];
  const commands = [
    ['independent25', [resolve(owned, 'replay.mjs'), 'ready-954f230.json']],
    ['author31', [...tests, 'tests/shell/env-replacement.test.ts', 'tests/shell/env-replacement-bounds.test.ts']],
    ['current-shell43', [...tests, 'tests/shell-stress/current-shell/current-shell.test.ts']],
    ['legacy72', [...tests, 'tests/shell-stress/invocation-modes/holdout.test.ts']],
    ['legacy132', [...tests, 'tests/shell/invocation-modes.test.ts']],
    ['source-eval86', [...tests, ...['source', 'source-host', 'eval', 'eval-host'].map(name => `tests/shell/source-dot-eval-${name}.test.ts`)]],
    ['prior211', [...tests, ...['discovery', 'read', 'sh'].map(name => `tests/shell/invocation-closure-${name}.test.ts`)]],
    ...[['global', []], ['build', ['-p', 'tsconfig.build.json']], ['benchmark', ['-p', 'benchmarks/tsconfig.json']]].map(([name, args]) => [name, ['node_modules/typescript/bin/tsc', ...args, '--noEmit'], true]),
  ];
  for (const [label, args, compiler] of commands) {
    await checkAnchors();
    const hashTrace = resolve(temporary, `${label}-hash.jsonl`); const pathTrace = resolve(temporary, `${label}-paths.log`);
    const childEnv = { ...env, PATH: `${patchDirectory}:/usr/bin:/bin`, CURRENT_SHELL_IMPORT_TRACE: hashTrace, INVOCATION_TRACE: pathTrace };
    const listed = compiler ? await runChild(process.execPath, [...args, '--listFilesOnly'], { env: childEnv, deadline: 60000 }) : undefined;
    if (listed) { assert.equal(listed.status, 0); pids.add(listed.pid); }
    const compilerPaths = listed ? Buffer.from(listed.stdout, 'base64').toString().split('\n').filter(path => path.startsWith('/') && /\.(?:ts|mts|cts|tsx)$/u.test(path)).map(path => relative(root, path)) : [];
    const phasePaths = [...new Set([...inputs, ...compilerPaths])];
    const before = await snapshot(phasePaths);
    const run = await runChild(process.execPath, [...args, ...(compiler ? ['--listFiles'] : [])], { env: childEnv, deadline: 100000 });
    pids.add(run.pid);
    const after = await snapshot(phasePaths);
    const loaded = (await readFile(hashTrace, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    for (const entry of loaded) pids.add(entry.pid);
    const traced = (await readFile(pathTrace, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(path => relative(root, path));
    const stdout = Buffer.from(run.stdout, 'base64').toString();
    const actual = [...new Set(compiler ? stdout.split('\n').filter(path => path.startsWith('/') && /\.(?:ts|mts|cts|tsx)$/u.test(path)).map(path => relative(root, path)) : [...loaded.map(entry => relative(root, entry.path)), ...traced])].sort();
    const mismatches = loaded.filter(entry => before[relative(root, entry.path)] !== entry.hash || after[relative(root, entry.path)] !== entry.hash);
    const changed = actual.filter(path => !before[path] || before[path] !== after[path]);
    const fixedInputDrift = phasePaths.filter(path => before[path] !== after[path]);
    const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
    const loadedManifest = Object.fromEntries(loaded.map(entry => [relative(root, entry.path), entry.hash]));
    const guarded = actual.length > 0 && changed.length === 0 && mismatches.length === 0;
    const record = { label, args, env: childEnv, run, listed, counts, before: store(before), after: store(after), actual, compilerPaths, loaded: store(loadedManifest), changed, mismatches, fixedInputDrift, guarded };
    records.push(record);
    for (const line of stdout.split('\n').filter(line => line.startsWith('# {"id":'))) { const match = /"pid":(\d+)/u.exec(line); if (match) pids.add(Number(match[1])); }
    console.log(JSON.stringify({ label, status: run.status, counts, guarded, actual: actual.length, changed, mismatches: mismatches.length, fixedInputDrift }));
    assert.equal(run.timedOut || run.overflow || run.groupAlive, false, label);
    await checkAnchors();
  }
  const product = JSON.parse(await readFile(resolve(owned, 'ready-954f230.json')));
  for (const row of product.rows) pids.add(row.run.pid);
  const current = await snapshot(inputs);
  const endpointDrift = records.map(record => ({ label: record.label, changed: record.actual.filter(path => current[path] !== undefined && current[path] !== manifests[record.after][path]).map(path => ({ path, tested: manifests[record.after][path], current: current[path] })) }));
  const visible = [];
  for (const pid of pids) if (Number.isInteger(pid)) for (const target of [pid, -pid]) { try { process.kill(target, 0); visible.push(target); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  for (const [path, hash] of Object.entries(frozen)) assert.equal(sha256(await readFile(path)), hash, path);
  save('acceptance-954f230.json', { started, finished: new Date().toISOString(), ready, revision, core, anchors, frozen, fixedPaths: inputs, manifests, records, product: product.summary, productFailures: product.rows.filter(row => !row.passed), historical: product.rows.filter(row => row.cohort === 'native' && row.profiles.find(profile => profile.role === 'HISTORICAL')?.pass).length, endpointDrift, checkedPids: pids.size, visible });
} finally { await rm(temporary, { recursive: true, force: true }); }

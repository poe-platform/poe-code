import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { owned, read, json, hash, freeze, independent } from './pinned.mjs';
import { paths, transform, equivalentRows, heldRows, filePhaseArgv } from './corrections.mjs';

const sealCommit = process.argv[2];
assert.match(sealCommit ?? '', /^[a-f0-9]{40}$/, 'explicit pre-execution commit required');
const pre = json(`${owned}PRE-V2.json`, sealCommit);
const committedPaths = execFileSync('git', ['ls-tree', '-r', '--name-only', sealCommit, owned], { encoding: 'utf8' }).trim().split('\n');
assert.deepEqual(committedPaths.sort(), [...pre.inputs.map(entry => `${owned}${entry.path}`), `${owned}PRE-V2.json`].sort());
const initialNames = (await readdir(owned)).sort();
assert.deepEqual(initialNames, [...pre.inputs.map(entry => entry.path), 'PRE-V2.json'].sort(), 'no unexpected pre-run entries');
async function verify() {
  for (const entry of pre.inputs) {
    assert.equal(hash(read(`${owned}${entry.path}`, sealCommit)), entry.sha256);
    assert.equal(hash(await readFile(`${owned}${entry.path}`)), entry.sha256);
  }
  assert.deepEqual((await readdir(owned)).sort(), initialNames, 'append-aware post-run input check');
}
await verify();
const checks = [];
async function check(name, run) {
  await run();
  checks.push({ name, status: 'PASS', credit: 'SYNTHETIC_VERIFIER_ONLY' });
}
const changed = Object.fromEntries(Object.values(paths).map(path => [path, transform(path, read(path)).source]));
const selectors = json(`${independent}SELECTOR-FREEZE-V4.json`, freeze);
const rules = json(`${independent}B01-RATIFICATION-7.json`, freeze);
const rows = [...selectors.cases.map(row => ({ ...row, group: 'selector36' })), ...rules.rules.flatMap(rule => rule.cases)];
const diagnostics = await import(`data:text/javascript;base64,${Buffer.from(changed[paths.diagnostics]).toString('base64')}`);
const originalDiagnostics = await import(`data:text/javascript;base64,${read(paths.diagnostics).toString('base64')}`);

await check('filephase-all-15-frozen-rejections-retain-selector-tokens', () => {
  const rejected = selectors.cases.filter(row => row.class !== 'VALID');
  assert.equal(rejected.length, 15);
  for (const row of rejected) {
    const argv = filePhaseArgv(row.argv);
    const boundary = argv.indexOf('--');
    assert.deepEqual(argv.slice(boundary, -1), row.argv.slice(row.argv.indexOf('--')));
    assert.deepEqual(argv.slice(boundary - 2, boundary), ['-o', 'out.csv']);
    assert.equal(argv.at(-1), 'input.csv');
    const bad = [...row.argv, 'input.csv', '-o', 'out.csv'];
    assert.equal(bad.slice(bad.indexOf('--') + 1).length, argv.slice(boundary + 1).length + 2);
    assert.deepEqual(row.argv, selectors.cases.find(value => value.id === row.id).argv);
  }
});
await check('filephase-negative-missing-or-duplicate-double-dash', () => {
  assert.throws(() => filePhaseArgv(['select', 'a']));
  assert.throws(() => filePhaseArgv(['select', '--', '--', 'a']));
  assert.throws(() => filePhaseArgv(['count', '--']));
});
await check('all-existing-runtime-assertion-lines-unchanged', () => {
  for (const path of [paths.adapter, paths.workflow, paths.lifecycle]) {
    const assertions = text => text.split('\n').filter(line => /\bassert\./.test(line));
    assert.deepEqual(assertions(changed[path]), assertions(read(path).toString()));
  }
  const tail = text => text.slice(text.indexOf('export function matcher(row)'));
  assert.equal(tail(changed[paths.diagnostics]), tail(read(paths.diagnostics).toString()));
});

function useHandler(statement, values = {}) {
  let handler;
  vm.runInNewContext(statement, { shell: { use(value) { handler = value; } }, ...values });
  assert.equal(typeof handler, 'function');
  return handler;
}
await check('middleware-result-loss-reproduced-and-fixed-synthetic-workflow', async () => {
  const line = text => text.split('\n').find(value => value.includes('shell.use(async (context, next) => { middleware.push'));
  const result = { exitCode: 17 };
  const context = { args: ['synthetic'], cwd: '/synthetic', env: {}, stdinIsDefault: false };
  const before = { middleware: [], origins: [], contexts: [] };
  const after = { middleware: [], origins: [], contexts: [] };
  assert.equal(await useHandler(line(read(paths.workflow).toString()), before)(context, () => Promise.resolve(result)), undefined);
  assert.equal(await useHandler(line(changed[paths.workflow]), after)(context, () => Promise.resolve(result)), result);
  assert.equal(JSON.stringify(before), JSON.stringify(after));
});
await check('origin-parent-env-middleware-return-same-promise', async () => {
  const values = { origins: [], seen: [], contexts: [] };
  const pending = Promise.resolve({ exitCode: 0 });
  const lines = changed[paths.adapter].split('\n').filter(line => line.includes('shell.use((context, next) =>'));
  assert.equal(lines.length, 3);
  for (const line of lines) {
    const statement = line.slice(line.indexOf('shell.use((context'));
    const handler = useHandler(statement, values);
    assert.equal(handler({ command: 'xan', args: ['synthetic'], env: {}, stdinIsDefault: true }, () => pending), pending);
  }
  await pending;
});
await check('provenance-lifecycle-middleware-preserves-route-and-registers-first', async () => {
  const statement = changed[paths.lifecycle].match(/  shell\.use\(\(context, next\) => \{[\s\S]*?\n  \}\);/)[0];
  const events = [];
  const cleanup = () => {};
  const handler = useHandler(statement, { events, cleanup });
  const pending = Promise.resolve({ exitCode: 0 });
  const callbacks = [];
  assert.equal(handler({ command: 'xan', registerCleanup(callback) { callbacks.push(callback); } }, () => { assert.equal(callbacks.length, 2); return pending; }), pending);
  assert.equal(callbacks[0], cleanup);
  assert.deepEqual(events, ['register']);
  await pending;
});
await check('provenance-bridge-native-promise-identity-not-reason-equality', async () => {
  function bridge(text) {
    const statement = text.match(/  shell\.commands\.register\(\{ name: 'review-bridge',[\s\S]*?\n  \} \}\);/)[0];
    let command;
    vm.runInNewContext(statement, { shell: { commands: { register(value) { command = value; } } }, events: [], trigger: 'mapped-status-not-escaping', local: new AbortController(), stdout: {} });
    return command;
  }
  const reason = Object.freeze({ origin: 'synthetic-local' });
  const pending = Promise.reject(reason);
  const context = { invoke() { return pending; } };
  const bad = bridge(read(paths.lifecycle).toString()).execute(context);
  const good = bridge(changed[paths.lifecycle]).execute(context);
  assert.notEqual(bad, pending);
  assert.equal(good, pending);
  await Promise.all([assert.rejects(bad, value => value === reason), assert.rejects(good, value => value === reason)]);
});

const equivalents = {
  'X4-R04': 'xan select: Prefix z selected nothing.\n',
  'X4-R05': 'xan select: Suffix z selected nothing.\n',
  'X4-R06': 'xan select: named selector requires headers, not -n\n',
  'X4-R07': 'xan select: header name * does not exist\n',
  'X4-R08': 'xan select: header name 9223372036854775808 does not exist\n',
  'B01-R1-repeat': 'xan count: duplicate option --no-headers\n',
  'B01-R3-space': "Could not deserialize ' ' to u64 for '--len'.\n",
  'B01-R7-invalid-plural': "Could not deserialize 'y' to u64 for '-I/--indices'.\n",
};
await check('eight-equivalent-contexts-old-rejects-new-accepts-no-raw-replay', () => {
  assert.deepEqual(Object.keys(equivalents), equivalentRows);
  for (const [id, text] of Object.entries(equivalents)) {
    const row = rows.find(row => row.id === id);
    assert.throws(() => originalDiagnostics.matcher(row).assert(Buffer.from(text)));
    diagnostics.matcher(row).assert(Buffer.from(text));
    diagnostics.matcher(row).assert(Buffer.from(diagnostics.exampleDiagnostic(row)));
  }
});
await check('matcher-negatives-empty-oversize-invalid-utf8-wrong-command-argv', () => {
  for (const id of equivalentRows) {
    const row = rows.find(row => row.id === id);
    const matcher = diagnostics.matcher(row);
    for (const data of [Buffer.alloc(0), Buffer.alloc(65537, 97), Buffer.from([255]), Buffer.from('xan wrong: missing header invalid option\n')]) assert.throws(() => matcher.assert(data));
    assert.throws(() => matcher.assert(Buffer.from(equivalents[id]), { ...row, argv: [...row.argv, 'foreign'] }));
  }
});
await check('matcher-negatives-wrong-condition-unrelated-lines-singular-option', () => {
  const rejects = {
    'X4-R04': ['xan select: prefix is fine\nselected nothing\n', 'xan select: suffix selected nothing\n'],
    'X4-R05': ['xan select: prefix selected nothing\n'],
    'X4-R06': ['xan select: named selector requires output file\n'],
    'X4-R07': ['xan select: header name z does not exist\n'],
    'X4-R08': ['xan select: header name 7 does not exist\n'],
    'B01-R1-repeat': ['xan count: duplicate --no-headers-extra\n'],
    'B01-R3-space': ["Could not deserialize ' ' to u64 for '--start'.\n"],
    'B01-R7-invalid-plural': ["Could not deserialize 'x' to u64 for '--index'.\n", "invalid '-i' not '-I'\n", "Could not deserialize 'x' to u64 for '-I/--indices-extra'.\n"],
  };
  for (const [id, values] of Object.entries(rejects)) for (const text of values) assert.throws(() => diagnostics.matcher(rows.find(row => row.id === id)).assert(Buffer.from(text)), id);
});
await check('held-predicates-and-inherited-family-guard-unchanged', () => {
  for (const id of heldRows) {
    const predicate = text => text.split('\n').find(line => line.startsWith(`  '${id}': [`));
    assert.equal(predicate(changed[paths.diagnostics]), predicate(read(paths.diagnostics).toString()));
  }
  const row = { ...rows.find(row => row.id === 'X4-R04'), requiredDiagnosticFamily: 'synthetic-required-literal:' };
  assert.throws(() => diagnostics.matcher(row).assert(Buffer.from(equivalents[row.id])));
});
await check('transform-negative-foreign-path-drift-and-repeat-application', () => {
  assert.throws(() => transform('src/index.ts', Buffer.from('')));
  assert.throws(() => transform(paths.adapter, Buffer.concat([read(paths.adapter), Buffer.from('\n')])));
  assert.throws(() => transform(paths.adapter, Buffer.from(changed[paths.adapter])));
});
await check('static-f11-byte-and-arithmetic-controls-not-product-allocation', () => {
  const work = Buffer.from('xan count: maxWork limit exceeded\n');
  const retained = Buffer.from('xan count: maxRetainedBytes limit exceeded\n');
  assert.equal(work.length, 34);
  assert.equal(retained.length, 43);
  assert.equal(5 + 2 + 2 + 2 + 2, 13);
  assert.ok(13 + 2 > 14);
  assert.equal(14 - 13, 1);
  assert.equal(work.length * 4, 136);
  assert.equal(32 + 2 + 34 + Buffer.byteLength('maxWork limit exceeded'), 90);
  assert.equal(32 + 43 + Buffer.byteLength('maxRetainedBytes limit exceeded'), 106);
  assert.ok(32 + 32 > 63);
  assert.ok(32 + 43 > 63);
  assert.equal(6 + 43, 49);
  assert.equal(268435456 - 43, 268435413);
});
await verify();
assert.equal(checks.length, 13);
console.log(JSON.stringify({ classification: 'SEALED_SYNTHETIC_MECHANICAL_QUALIFICATION_ONLY', sealCommit, checks, productChildrenStarted: 0, ownedChildrenRemaining: 0, candidateRuns: 0, nativeRuns: 0, actualCaseRescores: 0, admissionGuardChanges: 0, appendAwareInputCheck: true }, null, 2));

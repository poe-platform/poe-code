import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import vm from 'node:vm';
import { authenticate, digest } from '../../candidate-v1/boundary-app.mjs';
import { captureAstCases, compatibleAst } from './ast-core.mjs';
import { requireOwnData, serializePublicAst } from './instrumentation.mjs';
import { assess } from './assess.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), own = path.resolve(here, '../..');
const seal = JSON.parse(authenticate(path.join(here, 'SEAL.json'), process.argv[2]));
const allowed = new Map(seal.roles.map(role => [path.join(own, role.path), role.sha256])), loads = [], outcomes = [];
for (const [filename, expected] of allowed) authenticate(filename, expected);
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
registerHooks({ load(url, context, next) {
  if (url.startsWith('node:')) return next(url, context);
  const filename = fileURLToPath(url); assert.ok(allowed.has(filename), 'synthetic closure only');
  assert.ok(filename.includes('/synthetic-stubs/'), 'no product import during synthetic preparation');
  const result = next(url, context); assert.ok(result.source !== null && result.source !== undefined); assert.equal(digest(Buffer.from(result.source)), allowed.get(filename));
  loads.push({ path: filename, sha256: allowed.get(filename) }); return result;
} });
const check = (id, action) => {
  try { action(); outcomes.push({ id, pass: true }); }
  catch (reason) { outcomes.push({ id, pass: false, error: String(reason?.stack ?? reason) }); }
};
const actual = await import('./synthetic-stubs/layout-adapter-v2.mjs'), terminal = await import('./synthetic-stubs/terminal-adapter-v2.mjs'), mechanisms = await import('./synthetic-stubs/mechanism-adapter-v1.mjs');
assert.equal(digest(fs.readFileSync(path.join(here, 'synthetic-stubs/layout-adapter-v2.mjs'))), digest(fs.readFileSync(path.join(own, 'candidate-v1/layout-adapter-v2.mjs'))));
check('W01', () => assert.deepEqual(Object.getOwnPropertyNames(actual), ['candidate','execute','observeTerminalState','supportedIds']));
check('W02', () => assert.equal(actual.candidate, 'synthetic-not-product'));
check('W03', () => assert.deepEqual(actual.supportedIds, ['O11','M01','M02']));
check('W04', () => assert.equal(actual.observeTerminalState, terminal.observeTerminalState));
check('W05', () => assert.equal(actual.execute, mechanisms.execute));
check('W06', () => { const sentinel = {}; assert.equal(actual.observeTerminalState(sentinel), sentinel); });
check('W07', () => { let caught = false; try { actual.execute(); } catch (reason) { caught = true; assert.equal(reason, false); } assert.equal(caught, true); });
const cases = JSON.parse(fs.readFileSync(path.join(own, 's06-successor-v1/AST-COMPAT-v1.json'))).cases;
const scripts = [], api = { parseShell(script) { scripts.push(script); return { kind: 'stub-only', input: script, absent: undefined, list: ['😀'] }; } };
const baseline = captureAstCases(api, cases);
check('A01', () => assert.deepEqual(scripts, cases.map(row => row.script)));
check('A02', () => { const serialized = JSON.parse(JSON.stringify(baseline)); for (let index = 0; index < 4; index++) assert.equal(compatibleAst(api, cases[index], serialized[index]), true); });
check('A03', () => assert.throws(() => compatibleAst({ parseShell() { return { kind: 'changed' }; } }, cases[0], baseline[0]), /unchanged public own-data AST/u));
check('A04', () => assert.throws(() => compatibleAst(api, { ...cases[0], script: 'different literal' }, baseline[0])));
check('A05', () => assert.throws(() => serializePublicAst({ [Symbol('leak')]: 1 }), /private symbols/u));
check('A06', () => { let called = false; assert.throws(() => serializePublicAst({ get leak() { called = true; return 1; } }), /getters/u); assert.equal(called, false); });
check('A07', () => { const cycle = {}; cycle.next = cycle; assert.throws(() => serializePublicAst(cycle), /acyclic/u); });
check('A08', () => { const changed = Object.defineProperty({ kind: 'stub-only', input: cases[0].script, absent: undefined, list: ['😀'] }, 'input', { enumerable: false }); assert.throws(() => compatibleAst({ parseShell: () => changed }, cases[0], baseline[0])); });
check('A09', () => assert.throws(() => captureAstCases(api, [...cases].reverse())));
check('A10', () => assert.throws(() => serializePublicAst({ method() {} })));
check('D01', () => requireOwnData(vm.runInNewContext('({ first: 1, second: 2 })'), ['first','second']));
check('D02', () => assert.throws(() => requireOwnData({ second: 2, first: 1 }, ['first','second'])));
check('D03', () => { let hit = false; assert.throws(() => requireOwnData({ get first() { hit = true; return 1; }, second: 2 }, ['first','second'])); assert.equal(hit, false); });
check('D04', () => assert.throws(() => requireOwnData({ first: 1, second: 2, extra: true }, ['first','second'])));
const hash = 'a'.repeat(64), modulePath = '/synthetic/mutated.js';
function transcript(passes, code, extra = {}) {
  const ids = ['X','Y'], failed = ids.filter((id, index) => !passes[index]);
  return { stdout: [{ load: { path: modulePath, sha256: hash } }, { activation: { id: 'U', path: modulePath, sha256: hash, hits: 1 } }, ...ids.map((id, index) => ({ observation: { id, pass: passes[index], settled: true, disposed: true } })), { summary: { cases: 2, pass: 2 - failed.length, failed } }].map(row => JSON.stringify(row)).join('\n') + '\n', code, signal: null, fault: null, spawnError: null, groupAbsent: true, closeObserved: true, ...extra };
}
const requirement = { id: 'U', path: modulePath, sha256: hash, requiredFailed: ['X'], requiredPassed: ['Y'] }, load = [{ path: modulePath, sha256: hash }];
check('C01', () => assert.equal(assess(transcript([true,true], 0), ['X','Y'], load).accepted, true));
check('C02', () => assert.equal(assess(transcript([true,true], 1), ['X','Y'], load).coherent, false));
check('C03', () => assert.equal(assess(transcript([false,true], 1), ['X','Y'], load).coherent, true));
check('C04', () => assert.equal(assess(transcript([false,true], 1), ['X','Y'], load, requirement).mutantKilled, true));
check('C05', () => { const result = assess(transcript([true,true], 0), ['X','Y'], load, requirement); assert.equal(result.coherent, true); assert.equal(result.mutantKilled, false); assert.equal(result.survivedOrCompanionFailed, true); });
check('C06', () => assert.equal(assess(transcript([false,false], 1), ['X','Y'], load, requirement).mutantKilled, false));
check('C07', () => { const run = transcript([false,true], 1); run.stdout = run.stdout.split('\n').filter(line => !line.includes('activation')).join('\n'); assert.equal(assess(run, ['X','Y'], load, requirement).coherent, false); });
check('C08', () => assert.equal(assess(transcript([false,true], 78), ['X','Y'], load, requirement).mutantKilled, false));
check('C09', () => assert.equal(assess(transcript([false,true], 1, { groupAbsent: false }), ['X','Y'], load, requirement).mutantKilled, false));
check('C10', () => { const run = transcript([true,true], 0); run.stdout += JSON.stringify({ summary: { cases: 2, pass: 2, failed: [] } }) + '\n'; assert.equal(assess(run, ['X','Y'], load).coherent, false); });
check('C11', () => assert.equal(assess(transcript([false,true], 1), ['Y','X'], load, requirement).coherent, false));
check('C12', () => assert.equal(assess(transcript([false,true], 1), ['X','Y'], [{ path: modulePath, sha256: 'b'.repeat(64) }], requirement).coherent, false));
check('C13', () => { const run = transcript([true,true], 0); run.stdout = run.stdout.replace('"disposed":true', '"disposed":false'); assert.equal(assess(run, ['X','Y'], load).coherent, false); });
for (const [filename, expected] of allowed) authenticate(filename, expected);
assert.equal(outcomes.length, 34); assert.equal(loads.length, 3);
emit({ synthetic: outcomes, loads, count: outcomes.length, passed: outcomes.filter(row => row.pass).length, actualProductExecutions: 0 });
process.exitCode = outcomes.every(row => row.pass) ? 0 : 1;

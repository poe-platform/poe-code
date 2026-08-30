import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assertTraceStages, assertExactData, assertFutureBudget } from './stage-helper.mjs';
import { qualifyData } from './qualify-data.mjs';
const data = JSON.parse(fs.readFileSync(new URL('./INPUT.json', import.meta.url)));
const clone = value => JSON.parse(JSON.stringify(value));
const expectedGrant = clone(data.grant); expectedGrant.decision = 'GO';
const original = qualifyData(data.controls, data.row, expectedGrant, data.oldGrant, data.budget, data.oldBudget);
console.log(JSON.stringify({ kind: 'original', ...original }));
const results = [];
function check(id, action) { let error; try { action(); } catch (reason) { error = String(reason?.stack ?? reason); } const row = { kind: 'independent', id, passed: error === undefined, error }; results.push(row); console.log(JSON.stringify(row)); }
const exact = data.row.traceContract.stages;
const rejected = (stages, message) => assert.throws(() => assertTraceStages(data.row, stages), error => error.message === message);
for (const [id, positions] of [['L1',[1,0,2,3]],['L2',[0,1,2,3]],['L3',[0,2,1,3]],['L4',[0,2,3,1]]]) check(id, () => assert.equal(assertTraceStages(data.row, positions.map(index => clone(exact[index]))), true));
check('N1-string-status', () => { const stages = clone(exact); stages[2].exitCode = '0'; rejected(stages, 'STATUS'); });
check('N2-pending-stage', () => { const stages = clone(exact); stages[2].kind = 'pending'; rejected(stages, 'SETTLED_KIND'); });
check('N3-sparse-stages', () => { const stages = clone(exact); delete stages[2]; rejected(stages, 'EXACT_KEYS'); });
check('N4-argv-accessor-not-invoked', () => { const stages = clone(exact); let called = false; Object.defineProperty(stages[2].argv, '0', { get() { called = true; return 'rg'; }, enumerable: true }); rejected(stages, 'OWN_DATA_ONLY'); assert.equal(called, false); });
check('N5-inherited-argv', () => { const stages = clone(exact), originalArgv = stages[2].argv; delete stages[2].argv; Object.setPrototypeOf(stages[2], { argv: originalArgv }); rejected(stages, 'EXACT_KEYS'); });
check('N6-symbol-extra', () => { const stages = clone(exact); stages[2][Symbol('role')] = 'child'; rejected(stages, 'EXACT_KEYS'); });
check('N7-extra-argv', () => { const stages = clone(exact); stages[2].argv.push('extra'); rejected(stages, 'MISSING_OR_CHANGED_STAGE'); });
check('T1-throw-identity-boolean', () => {
  const row = { traceContract: { schema: 'exact-stage-tuples-v1', stages: [{ argv: ['curl'], stdinIsDefault: true, kind: 'throw', callerReasonSameObject: true }], before: [] } };
  assert.equal(assertTraceStages(row, clone(row.traceContract.stages)), true);
  for (const value of [false,1,'true',null]) { const stages = clone(row.traceContract.stages); stages[0].callerReasonSameObject = value; assert.throws(() => assertTraceStages(row, stages), /THROWN_REASON/); }
});
check('D1-declared-duplicate-multiset', () => { const stage = clone(exact[2]), row = { traceContract: { schema: 'exact-stage-tuples-v1', stages: [stage,clone(stage)], before: [] } }; assert.equal(assertTraceStages(row, [clone(stage),clone(stage)]), true); assert.throws(() => assertTraceStages(row, [clone(stage)]), /EXACT_STAGE_MULTIPLICITY/); row.traceContract.before = [[0,1]]; assert.throws(() => assertTraceStages(row, [clone(stage),clone(stage)]), /AMBIGUOUS_ORDER_ROLE/); });
check('X1-fixed-cross-realm-data', () => {
  const other = vm.runInNewContext('({argv:["curl"],stdinIsDefault:true,kind:"result",exitCode:0})', Object.create(null), { timeout: 100 });
  const row = { traceContract: { schema: 'exact-stage-tuples-v1', stages: [clone(other)], before: [] } }; assert.equal(assertTraceStages(row, [other]), true);
});
check('B1-template-not-grant', () => assert.throws(() => assertExactData(data.grant, expectedGrant), /EXACT_DATA_VALUE/));
check('B2-old-closed-budget', () => assert.throws(() => assertFutureBudget(data.oldBudget)));
check('B3-increased-ceiling', () => { const budget = clone(data.budget); budget.remaining.children++; assert.throws(() => assertFutureBudget(budget), /EXACT_DATA_VALUE/); });
check('B4-lower-capture-not-authority', () => { const budget = clone(data.budget); budget.remaining.captureBytes--; assert.throws(() => assertFutureBudget(budget), /EXACT_DATA_VALUE/); });
check('B5-source-P01-selection', () => { const grant = clone(expectedGrant); grant.selection[0] = 'source-build:P01'; assert.throws(() => assertExactData(grant, expectedGrant), /EXACT_DATA_VALUE/); });
check('B6-old-root', () => { const grant = clone(expectedGrant); grant.root = data.oldGrant.root; assert.throws(() => assertExactData(grant, expectedGrant), /EXACT_DATA_VALUE/); });
check('B7-budget-accessor-not-invoked', () => { const budget = clone(data.budget); let called = false; Object.defineProperty(budget.remaining, 'children', { enumerable: true, get() { called = true; return 85; } }); assert.throws(() => assertFutureBudget(budget), /OWN_DATA_ONLY/); assert.equal(called, false); });
check('B8-extra-grant-key', () => { const grant = clone(expectedGrant); grant.liveHead = true; assert.throws(() => assertExactData(grant, expectedGrant), /EXACT_KEYS/); });
const pass = original.pass && results.every(row => row.passed);
console.log(JSON.stringify({ kind: 'summary', originalCounts: [original.originalNine.length, original.additionalObservable.length, original.bindingControls.length], independent: results.length, passed: results.filter(row => row.passed).length, pass, productImports: 0, workerStarts: 0, supervisorImports: 0 }));
process.exitCode = pass ? 0 : 1;

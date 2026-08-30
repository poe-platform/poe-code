import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { createGetoptsState: fresh, cloneGetoptsState: clone, withGetoptsIndex: at, scanGetopts: scan } = await import(pathToFileURL(process.env.REVIEW_MODULE).href);
const options = { reportErrors: true, work: { maxArguments: 64, maxBytes: 4096, maxSteps: 16384, yieldEvery: 16, checkpoint: () => {} } };
const results = [];
const run = async (id, operation) => { try { results.push({ id, status: 'pass', detail: await operation() }); } catch (error) { results.push({ id, status: 'fail', error: { name: error.name, message: error.message, stack: error.stack } }); } };
const protect = (state) => { if (state.active) Object.freeze(state.active); return Object.freeze(state); };
await run('R01/in-range-clone-isolation', async () => {
  const args = Object.freeze(['-pqr', 'operand']);
  const parent = protect((await scan(fresh(), 'pqr', args, options)).state); const before = structuredClone(parent);
  const left = clone(parent); const right = clone(parent); assert.notEqual(left.active, right.active); assert.notEqual(left.active, parent.active);
  const reset = await scan(at(left, 1), 'pqr', args, options); assert.equal(reset.option, 'p'); assert.equal(reset.optind, 1);
  const untouched = await scan(right, 'pqr', args, options); assert.equal(untouched.option, 'q'); assert.equal(untouched.optind, 1);
  const jumped = await scan(at(parent, 2), 'pqr', args, options); assert.equal(jumped.option, 'q'); assert.equal(jumped.optind, 2);
  assert.deepEqual(parent, before); return { parent, reset, untouched, jumped };
});
for (const [id, firstArgs] of [['R02/out-of-range-retained-cursor', ['-pqr']], ['R03/shortened-vector', ['-pqr', 'operand']]]) await run(id, async () => {
  const parent = protect((await scan(fresh(), 'pqr', Object.freeze(firstArgs), options)).state); const before = structuredClone(parent);
  const jumped = protect(at(parent, 2)); assert.deepEqual(jumped.active, parent.active); assert.notEqual(jumped.active, parent.active);
  const result = await scan(jumped, 'pqr', Object.freeze(['-pqr']), options);
  assert.deepEqual(result, { state: { index: 2 }, kind: 'end', status: 1, option: '?', optind: 2, argument: { kind: 'unset' }, diagnostic: null });
  assert.deepEqual(parent, before); assert.equal(jumped.index, 2); assert.deepEqual(jumped.active, parent.active);
  return { parent, jumped, result };
});
const counts = { total: results.length, pass: results.filter((result) => result.status === 'pass').length, fail: results.filter((result) => result.status === 'fail').length };
await writeFile(process.env.REVIEW_OUTPUT, JSON.stringify({ scope: 'supplemental corrected controls; frozen P03 remains failed', mode: process.env.REVIEW_MODE, module: process.env.REVIEW_MODULE, counts, results }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(counts));
process.exitCode = counts.fail ? 1 : 0;

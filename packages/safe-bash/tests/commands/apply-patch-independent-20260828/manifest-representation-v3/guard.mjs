import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { ownEqual, describe } from './common.mjs';
import { installLoader } from './loader.mjs';

const job = JSON.parse(fs.readFileSync(process.argv[2]));
assert.deepEqual(Object.fromEntries(Object.keys(process.env).sort().map(key => [key, process.env[key]])), job.env);
const expected = { role: 'data', args: ['literal', 0, false], maximum: 2 };
assert.ok(ownEqual(vm.runInNewContext('({role:"data",args:["literal",0,false],maximum:2})'), expected));
let reads = 0;
for (const candidate of [null, { ...expected, extra: true }, { ...expected, maximum: '2' }, { args: expected.args, role: 'data', maximum: 2 }, { ...expected, args: ['literal', , false] }, Object.defineProperty({ ...expected }, 'role', { get() { reads++; return 'data'; } })]) assert.equal(ownEqual(candidate, expected), false);
assert.equal(reads, 0);
for (const reason of [false, 0, null, undefined, {}]) { let selected = false; try { throw reason; } catch (actual) { selected = true; assert.equal(actual, reason); } assert.equal(selected, true); }
assert.ok(fs.lstatSync(path.join(job.consumer, 'link')).isSymbolicLink());
assert.equal(fs.readlinkSync(path.join(job.consumer, 'link')), 'regular');
assert.throws(() => describe(path.join(job.consumer, 'link')), /regular file/);
assert.deepEqual(describe(path.join(job.consumer, 'regular')), job.regular);
const loads = installLoader(job);
globalThis.guardEvaluations = 0;
for (const name of ['wrong-hash.js', 'wrong-mode.js', 'unbound.js']) {
  let rejected = false;
  try { await import(pathToFileURL(path.join(job.graphs[0].product, name)).href); }
  catch { rejected = true; }
  assert.equal(rejected, true); assert.equal(globalThis.guardEvaluations, 0);
}
await import(pathToFileURL(path.join(job.graphs[0].product, 'positive.js')).href);
assert.equal(globalThis.guardEvaluations, 1); assert.equal(loads.length, 1);
console.log(JSON.stringify({ kind: 'guard', primitiveOwnData: 8, falsyIdentities: 5, symlinkRefusal: 1, negativeLoads: 3, restoredIndependentPositive: 1, evaluations: 1, getterReads: reads, loads }));

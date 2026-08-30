import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { admit, main } from './bootstrap.mjs';

const scope = import.meta.dirname;
const scratch = path.join(scope, 'control-output');
const rows = [];
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
try {
  fs.mkdirSync(scratch);
  const file = path.join(scratch, 'owned.txt'), body = Buffer.from('B1 owned DATA\n');
  fs.writeFileSync(file, body, { flag: 'wx' });
  const expected = { bytes: body.length, sha256: sha(body) };
  const check = async (id, action) => { await action(); rows.push({ id, pass: true, role: 'PURE_DATA_NO_PRODUCT' }); };
  await check('D01-valid', () => assert.deepEqual(admit(file, expected, 64), body));
  await check('D02-size', () => assert.throws(() => admit(file, { ...expected, bytes: expected.bytes + 1 }, 64)));
  await check('D03-hash', () => assert.throws(() => admit(file, { ...expected, sha256: '0'.repeat(64) }, 64)));
  await check('D04-cap', () => assert.throws(() => admit(file, expected, 1)));
  await check('D05-directory', () => assert.throws(() => admit(scratch, expected, 64)));
  await check('D06-missing', () => assert.throws(() => admit(path.join(scratch, 'missing'), expected, 64)));
  await check('D07-symlink', () => { const link = path.join(scratch, 'link'); fs.symlinkSync('owned.txt', link); assert.throws(() => admit(link, expected, 64)); fs.unlinkSync(link); });
  await check('D08-content-change', () => { fs.writeFileSync(file, Buffer.alloc(body.length)); assert.throws(() => admit(file, expected, 64)); fs.writeFileSync(file, body); });
  await check('D09-restored', () => assert.deepEqual(admit(file, expected, 64), body));
  await check('D10-no-implicit-dispatch', () => assert.rejects(main([])));
  await check('D11-no-ambient-B0-grant', async () => { assert.notEqual(process.env.B1_ROOT_GO, 'ROOT_B1_PUBLIC15_EXPLICIT_FRESH_AUTHORIZATION'); await assert.rejects(main(['--run', file, expected.sha256, String(expected.bytes)])); });
  const seal = JSON.parse(fs.readFileSync(path.join(scope, 'PRESEAL.json'), 'utf8'));
  await check('D12-five-exact-ids', () => assert.deepEqual(seal.ids, ['C10','C11','C15','C16','C18']));
  await check('D13-separated-counts', () => assert.deepEqual(seal.remaining, { B0AuthorObserved: 39, B1Planned: 15, B2Planned: 672, totalPlanned: 726, unit2PerLayout: 50, B2RuntimeStatus: 'UNRUN' }));
  await check('D14-worker-route', () => { assert.equal(seal.bounds.guestWorkersPerLayout, 5); assert.equal(seal.bounds.guestWorkersTotal, 15); assert.equal(seal.bounds.regexWorkers, 0); assert.equal(seal.bounds.internalLoaderThreads, 0); });
  await check('D15-distinct-slot', () => { assert.ok(seal.workRoot.includes('b1-public15')); assert.equal(fs.existsSync(seal.workRoot), false); });
  fs.writeFileSync(path.join(scope, 'CONTROL-RESULT.json'), JSON.stringify({ at: new Date().toISOString(), groups: rows, productImports: 0, guestEngineImports: 0, childrenSpawned: 0, workers: 0, qualification: 'Real file admission and inert bootstrap refusal; not actual owner fault injection, native-FD or Worker execution.' }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ groups: rows.length, passed: rows.length, productImports: 0, workers: 0 }));
} catch (error) { console.error(error); process.exitCode = 78; }

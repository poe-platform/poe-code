import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { admitFile } from './admission.mjs';
import { mapImports } from './origins.mjs';
import { completeWrite, durableJSON, clock, supervisor } from '../stage-b0-r3/owner.mjs';

const scope = import.meta.dirname, scratch = path.join(scope, 'control-output');
const rows = [];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const capture = promise => Promise.resolve(promise).then(value => ({ ok: true, value }), reason => ({ ok: false, reason }));
const check = async (id, action) => { await action(); rows.push({ id, status: 'PASS', role: 'PURE_DATA_OR_SYNTHETIC_NO_OS_CHILD' }); };
try {
  fs.mkdirSync(scratch);
  const file = path.join(scratch, 'input.json'), body = Buffer.from('{"bound":true}\n'); fs.writeFileSync(file, body, { flag: 'wx' });
  const identity = { bytes: body.length, sha256: hash(body) };
  await check('P01-own-new-origin', () => { const edges = mapImports([{ stagedPath: 'consumer.mjs', body: Buffer.from("import {admitFile} from './admission.mjs';"), origin: { kind: 'OWN_NEW' } }, { stagedPath: 'admission.mjs', body: Buffer.from('export const admitFile = 1;'), origin: { kind: 'OWN_NEW', notInherited: true } }]); assert.equal(edges.length, 1); assert.equal(edges[0].origin.notInherited, true); });
  await check('P02-missing-and-escape', () => { for (const specifier of ['./missing.mjs','../../outside.mjs']) assert.throws(() => mapImports([{ stagedPath: 'consumer.mjs', body: Buffer.from(`import '${specifier}';`), origin: { kind: 'OWN_NEW' } }])); const body = Buffer.from('const diagnostic = `unsupported import \'${declarator.id.name}\'`;\nconst regex = /import["\']/;\n// import "./missing.mjs"\n'); assert.deepEqual(mapImports([{ stagedPath: 'data.mjs', body, origin: { kind: 'OWN_NEW' } }]), []); });
  await check('P03-admitted-same-buffer', () => { const admitted = admitFile(file, identity, 64); assert.deepEqual(admitted, body); assert.deepEqual(JSON.parse(admitted), { bound: true }); });
  await check('P04-before-read-identity', () => { let reads = 0; const original = fs.readFileSync; fs.readFileSync = (...args) => { reads++; return original(...args); }; try { assert.throws(() => admitFile(file, { ...identity, bytes: identity.bytes + 1 }, 64)); assert.throws(() => admitFile(file, identity, 1)); assert.equal(reads, 0); } finally { fs.readFileSync = original; } });
  await check('P05-bad-hash-before-parse', () => { let parsed = false; assert.throws(() => { const admitted = admitFile(file, { ...identity, sha256: '0'.repeat(64) }, 64); parsed = true; JSON.parse(admitted); }); assert.equal(parsed, false); });
  await check('P06-own-data-and-link', () => { let accessed = false; assert.throws(() => admitFile(file, { get bytes() { accessed = true; return body.length; }, sha256: identity.sha256 }, 64)); assert.equal(accessed, false); const link = path.join(scratch, 'alias'); fs.symlinkSync('input.json', link); try { assert.throws(() => admitFile(link, identity, 64)); } finally { fs.unlinkSync(link); } });
  await check('P07-short-zero-writes', () => { const received = []; assert.equal(completeWrite({ writeSync(_fd, bytes, offset, length) { const count = Math.min(2, length); received.push(bytes.subarray(offset, offset + count)); return count; } }, 1, body), body.length); assert.deepEqual(Buffer.concat(received), body); for (const count of [0,-1,body.length+1,NaN]) assert.throws(() => completeWrite({ writeSync() { return count; } }, 1, body)); });
  await check('P08-raw-falsy-primary', () => { for (const reason of [undefined,null,false,0,'']) { let closed = false, caught = false; try { durableJSON({ openSync() { return 7; }, writeSync() { throw reason; }, fsyncSync() {}, closeSync() { closed = true; throw new Error('secondary'); } }, 'synthetic', {}); } catch (error) { caught = true; assert.equal(error, reason); } assert.equal(caught, true); assert.equal(closed, true); } });
  await check('P09-clock-reserve', () => { let now = 0; const shared = clock(0, () => now, 1800, 180); assert.equal(shared.remaining(), 1620000); now = 1620000; assert.throws(() => shared.remaining()); assert.equal(shared.publication(), 180000); now = 1800000; assert.throws(() => shared.publication()); });
  await check('P10-second-open-closes-first', async () => {
    let descriptor = 0, spawned = 0; const closed = [];
    const io = { openSync() { descriptor++; if (descriptor === 3) throw 0; return descriptor; }, writeSync(_fd, _body, _offset, length) { return length; }, fsyncSync() {}, closeSync(value) { closed.push(value); } };
    const owner = supervisor('synthetic', 1620, 65536, { io, now: () => 0, started: 0, spawn() { spawned++; throw new Error('must not spawn'); } });
    const result = await capture(owner.run('offline-install', 'synthetic-node', [], { cwd: '.', env: {}, seconds: 1 }));
    assert.equal(result.ok, false); assert.equal(result.reason, 0); assert.equal(spawned, 0); assert.ok(closed.includes(2)); owner.abort(result.reason);
  });
  await check('P11-known-synthetic-lifecycle', async () => {
    let descriptor = 0; const signals = [];
    const io = { openSync() { return ++descriptor; }, writeSync(_fd, _body, _offset, length) { return length; }, fsyncSync() {}, closeSync() {} };
    const owner = supervisor('synthetic', 1620, 65536, { io, now: () => 0, started: 0, kill(pid, signal) { signals.push([pid,signal]); const error = new Error('absent synthetic group'); error.code = 'ESRCH'; throw error; }, spawn() { const child = new EventEmitter(); child.pid = 123456; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); setImmediate(() => { child.stdout.end(); child.stderr.end(); child.emit('exit',0,null); child.emit('close',0,null); }); return child; } });
    const result = await owner.run('offline-install', 'synthetic-node', [], { cwd: '.', env: {}, seconds: 1 }); assert.equal(result.pid, 123456); assert.deepEqual(signals, [[-123456,0]]); const final = owner.finish(); assert.equal(final.children, 1); assert.deepEqual(final.failures, []);
  });
  await check('P12-role-mapping', () => { const seal = JSON.parse(fs.readFileSync(path.join(scope, 'PRESEAL.json'))); assert.deepEqual(seal.ids, ['C10','C11','C15','C16','C18']); assert.deepEqual(seal.knownRoles, ['offline-install','workflow-source-built','workflow-installed','workflow-physically-moved']); assert.equal(seal.bounds.guestWorkersTotal, 15); assert.equal(seal.remaining.B2Planned, 672); assert.equal(seal.remaining.unit2PerLayout, 50); });
  fs.writeFileSync(path.join(scope, 'CONTROL-RESULT.json'), JSON.stringify({ at: new Date().toISOString(), groups: rows, actualNodeControllers: 1, actualOSChildrenSpawned: 0, actualWorkers: 0, productImports: 0, engineImports: 0, qualification: 'File admission and whole inherited-owner synthetic dependency injection, not native FD/OS child/Worker/engine proof.' }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: rows.length, failed: 0, productImports: 0, engineImports: 0, actualChildren: 0 }));
} catch (error) { console.error(error); fs.writeFileSync(path.join(scope, 'CONTROL-FAILURE.json'), JSON.stringify({ completed: rows, primaryPresent: true, type: typeof error, error: String(error), actualProductCalls: 0 }) + '\n', { flag: 'wx' }); process.exitCode = 78; }

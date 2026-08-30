import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
import { makeCases } from './cases.mjs';
import { hash } from './fixtures.mjs';

export async function run(packet) {
  let token = 0;
  const capture = async (name, bytes) => {
    const current = ++token;
    const admitted = new Promise(resolve => { const receive = message => { if (message.kind === 'reserved' && message.token === current) { process.off('message', receive); resolve(); } }; process.on('message', receive); });
    process.send({ kind: 'reserve', token: current, bytes: Buffer.byteLength(bytes) }); await admitted;
    await fs.writeFile(path.join(packet.capture, name), bytes, { flag: 'wx' });
  };
  const active = new Set(); let created = 0, closed = 0, maximum = 0;
  const original = zlib.createInflate;
  Object.defineProperty(zlib, 'createInflate', { configurable: true, value(...args) {
    const codec = original(...args); created++; active.add(codec); maximum = Math.max(maximum, active.size);
    codec.once('close', () => { active.delete(codec); closed++; }); return codec;
  } });
  syncBuiltinESMExports();
  const prefix = packet.source ? 'src' : 'dist';
  const entry = path.join(packet.root, prefix, 'commands/git/index.' + (packet.source ? 'ts' : 'js'));
  const api = await import(pathToFileURL(entry).href);
  const core = await import(pathToFileURL(path.join(packet.root, prefix, 'index.' + (packet.source ? 'ts' : 'js'))).href);
  const io = await import(pathToFileURL(path.join(packet.root, prefix, 'commands/git/io.' + (packet.source ? 'ts' : 'js'))).href);
  const limits = await import(pathToFileURL(path.join(packet.root, prefix, 'commands/git/limits.' + (packet.source ? 'ts' : 'js'))).href);
  const actualResolve = import.meta.resolve(pathToFileURL(entry).href);
  if (packet.mutant) assert.equal(globalThis.__reviewMutant, packet.mutant, 'mandatory actually loaded mutant sentinel');
  process.send({ kind: 'product-loaded', entry: actualResolve, mutant: packet.mutant ?? null });
  const recordsBytes = await fs.readFile(packet.records);
  assert.equal(hash(recordsBytes), packet.recordsSha256);
  const environment = { api, core, records: JSON.parse(recordsBytes), observations: [], internals: { Session: io.Session, limits: limits.GIT_LIMITS }, realRoot: packet.realRoot };
  const suite = makeCases(environment).filter(row => !packet.only || packet.only.includes(row.id));
  assert.equal(suite.length, packet.expectedCases);
  const results = [];
  for (const test of suite) {
    const controller = new AbortController(), start = process.hrtime.bigint(); let timedOut = false;
    environment.signal = controller.signal; environment.observations = [];
    const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('CASE_TIMEOUT')); }, 30000);
    const row = { id: test.id, title: test.title, layout: packet.layout, observations: environment.observations };
    try { await test.body(); row.status = 'PASS'; }
    catch (error) { row.status = 'FAIL'; row.error = { name: error?.name, message: String(error?.message ?? error), stack: error?.stack, actual: error?.actual, expected: error?.expected, operator: error?.operator }; }
    finally { clearTimeout(timer); }
    row.elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    row.nativeZlib = { created, closed, outstanding: active.size, maxConcurrent: maximum };
    row.safety = timedOut || active.size !== 0 || row.observations.some(item => item.streams?.active || item.cleanup?.some(value => value !== 'fulfilled') || item.mutations?.length || JSON.stringify(item.before) !== JSON.stringify(item.after));
    const bytes = Buffer.from(JSON.stringify(row) + '\n'); assert.ok(bytes.length <= 8 * 1024 * 1024, 'case raw bound');
    await capture(`${test.id}.json`, bytes);
    process.send({ kind: 'case', id: row.id, status: row.status, bytes: bytes.length, safety: row.safety, message: row.error?.message });
    console.log(JSON.stringify({ id: row.id, status: row.status, elapsedMs: row.elapsedMs, message: row.error?.message, safety: row.safety }));
    results.push({ id: row.id, status: row.status, safety: row.safety, sha256: hash(bytes), bytes: bytes.length });
    if (row.safety) break;
  }
  Object.defineProperty(zlib, 'createInflate', { configurable: true, value: original }); syncBuiltinESMExports();
  const result = { layout: packet.layout, entry: actualResolve, physicalResolve: packet.physicalResolve, mutantSentinel: packet.mutant ? globalThis.__reviewMutant : null, productSource: packet.candidate, expected: packet.expectedCases, executed: results.length, pass: results.filter(row => row.status === 'PASS').length, fail: results.filter(row => row.status === 'FAIL').length, safety: results.some(row => row.safety), nativeZlib: { created, closed, outstanding: active.size, maxConcurrent: maximum }, cases: results };
  await capture('RESULT.json', JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.fail || result.safety ? 1 : 0;
}

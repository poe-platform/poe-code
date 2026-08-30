import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = process.env.GIT_AUTHOR_ROOT;
const { MemoryFileSystem } = await import(pathToFileURL(path.join(root, 'dist/index.js')).href);
const { Session } = await import(pathToFileURL(path.join(root, 'dist/commands/git/io.js')).href);
const { PackCatalogue } = await import(pathToFileURL(path.join(root, 'dist/commands/git/pack.js')).href);
const { createGitCommand } = await import(pathToFileURL(path.join(root, 'dist/commands/git/index.js')).href);
const data = JSON.parse(await fs.readFile(new URL('packs.json', import.meta.url)));
const neutral = JSON.parse(await fs.readFile(new URL('fixture.json', import.meta.url)));
const fixture = data.fixtures.find(row => row.id === 'P11'); assert.ok(fixture && fixture.count === 2);
const fixedPack = Buffer.from(fixture.packBase64, 'base64'), fixedIndex = Buffer.from(fixture.indexBase64, 'base64');
const cases = [];
const hash = bytes => createHash('sha1').update(bytes).digest();
const reseal = bytes => hash(bytes.subarray(0, -20)).copy(bytes, bytes.length - 20);
const kind = value => value === null ? 'null' : value === undefined ? 'undefined' : value instanceof Error ? 'Error' : typeof value;

function observer(target, mode, reason) {
  const originals = Object.fromEntries(['allocate', 'reserve', 'release', 'unreserve', 'step'].map(name => [name, target[name]]));
  const bufferAlloc = Buffer.alloc;
  const live = new Map(), released = new Map(), events = [];
  let active, fired = 0, slot, buckets, successfulBucket = false;
  const mark = (action, size, extra = {}) => events.push({ action, size, ...extra });
  const indexCall = () => /PackCatalogue\.index/.test(new Error().stack ?? '');
  target.allocate = function(size) {
    const saved = active; active = { owner: this, size, index: indexCall() };
    mark('allocate-start', size, { index: active.index });
    try {
      const bytes = originals.allocate.call(this, size);
      live.set(bytes, size);
      if (active.index && size === 1) slot = bytes;
      if (active.index && size === 1024) { buckets = bytes; successfulBucket = true; }
      mark('allocate-return', size); return bytes;
    } catch (error) { mark('allocate-throw', size, { reason: kind(error) }); throw error; }
    finally { active = saved; }
  };
  target.reserve = function(size) {
    const targetSize = process.env.S01_CONTROL === 'unreached' ? 1025 : 1024;
    if ((mode === 'reserve' && active?.index && active.size === targetSize) || (mode === 'first' && active?.index && size === 1)) { fired++; mark('injected-reserve', size, { reason: kind(reason) }); throw reason; }
    const result = originals.reserve.call(this, size); mark('reserve-success', size); return result;
  };
  Buffer.alloc = function(size, ...args) {
    const targetSize = process.env.S01_CONTROL === 'unreached' ? 1025 : 1024;
    if (mode === 'allocation' && active?.index && active.size === targetSize) { fired++; mark('injected-Buffer.alloc', size, { reason: kind(reason) }); throw reason; }
    return Reflect.apply(bufferAlloc, Buffer, [size, ...args]);
  };
  target.release = function(bytes) {
    released.set(bytes, (released.get(bytes) ?? 0) + 1); mark('release-call', bytes.length, { ownedObserved: live.has(bytes) });
    const result = originals.release.call(this, bytes); live.delete(bytes); return result;
  };
  target.unreserve = function(size) { mark('unreserve', size); return originals.unreserve.call(this, size); };
  target.step = async function(...args) {
    if (mode === 'step' && successfulBucket) { fired++; successfulBucket = false; mark('injected-step', 0, { reason: kind(reason) }); throw reason; }
    return originals.step.apply(this, args);
  };
  return {
    live, released, events,
    get slot() { return slot; }, get buckets() { return buckets; }, get fired() { return fired; },
    restore() { for (const [name, fn] of Object.entries(originals)) target[name] = fn; Buffer.alloc = bufferAlloc; assert.equal(Buffer.alloc, bufferAlloc); },
    snapshot() { return { events, fired, slotAcquired: Boolean(slot), slotReleases: slot ? released.get(slot) ?? 0 : 0, bucketAcquired: Boolean(buckets), bucketReleases: buckets ? released.get(buckets) ?? 0 : 0, liveLengths: [...live.values()], nativeAllocationFailure: false, countersChanged: false }; },
  };
}

async function context() {
  const memory = new MemoryFileSystem(), cleanups = [], stdout = [], stderr = [];
  for (const file of neutral.files) { const name = '/repo/' + file.path; await memory.mkdir(path.posix.dirname(name), { recursive: true }); await memory.writeFile(name, file.text === undefined ? Buffer.from(file.base64, 'base64') : Buffer.from(file.text)); await memory.chmod(name, file.mode); }
  const name = '/repo/.git/objects/pack/pack-' + fixture.packSha1;
  await memory.mkdir(path.posix.dirname(name), { recursive: true }); await memory.writeFile(name + '.pack', fixedPack); await memory.writeFile(name + '.idx', fixedIndex);
  return { context: { command: 'git', args: ['rev-parse', '--absolute-git-dir'], cwd: '/repo', env: {}, fs: memory, signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() { throw Error('unexpected stdin'); } }, stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } }, registerCleanup(fn) { cleanups.push(fn); } }, cleanups, stdout, stderr };
}
async function record(id, run) {
  const timer = setTimeout(() => { console.error('S01_CASE_DEADLINE', id); process.exit(78); }, 30000);
  let evidence;
  try { evidence = await run(value => { evidence = value; }); cases.push({ id, status: 'PASS', evidence }); }
  catch (error) { cases.push({ id, status: 'FAIL', error: String(error?.stack ?? error), evidence }); }
  finally { clearTimeout(timer); }
}
async function indexCase(mode, reason, corruption, publish) {
  const host = await context(), session = new Session(host.context, '/'), catalogue = new PackCatalogue(session), index = Buffer.from(fixedIndex);
  if (corruption === 'oid') index.copy(index, 1052, 1032, 1052);
  if (corruption === 'offset') index.writeUInt32BE(0x7fffffff, 1080);
  if (corruption === 'fanout') index.writeUInt32BE(2, 8);
  if (corruption) reseal(index);
  const watch = observer(session, mode, reason); let rejected = false, escaped, rows;
  try { rows = await catalogue.index(index, fixedPack); } catch (error) { rejected = true; escaped = error; }
  finally { try { await session.operation.close(); } finally { try { session.finish(); } finally { watch.restore(); } } }
  const evidence = { ...watch.snapshot(), rejected, reasonIdentity: rejected && escaped === reason, rows: rows?.length }; publish(evidence);
  if (mode === 'none' && !corruption) { assert.equal(rejected, false); assert.equal(rows.length, 2); }
  else assert.equal(rejected, true);
  if (mode !== 'none') { assert.equal(watch.fired, 1, 'fault injection must actually reach the selected site'); assert.equal(escaped, reason); }
  if (mode === 'first') { assert.equal(watch.slot, undefined); assert.equal(watch.buckets, undefined); }
  else { assert.ok(watch.slot); assert.equal(watch.released.get(watch.slot), 1, 'first acquired slot owner must release once'); }
  if (watch.buckets) assert.equal(watch.released.get(watch.buckets), 1);
  assert.equal(watch.live.size, 0, 'no observed acquired buffer remains after index scope');
  if (mode === 'allocation') { assert.ok(watch.events.some(row => row.action === 'reserve-success' && row.size === 1024)); assert.equal(watch.events.filter(row => row.action === 'unreserve' && row.size === 1024).length, 1); }
  if (mode === 'reserve') assert.equal(watch.events.filter(row => row.action === 'reserve-success' && row.size === 1024).length, 0);
  return evidence;
}
for (const mode of ['reserve', 'allocation']) for (const [label, reason] of [['error', new Error('S01 synthetic allocation fault')], ['null', null], ['undefined', undefined]]) await record(`${mode}-${label}`, publish => indexCase(mode, reason, undefined, publish));
await record('first-reserve', publish => indexCase('first', new Error('first reserve'), undefined, publish));
for (const corruption of ['oid', 'offset', 'fanout']) await record(`later-${corruption}`, publish => indexCase('none', undefined, corruption, publish));
await record('later-step', publish => indexCase('step', Symbol('step'), undefined, publish));
await record('valid-index', publish => indexCase('none', undefined, undefined, publish));
for (const mode of ['reserve', 'allocation']) await record(`public-${mode}`, async publish => {
  const host = await context(), reason = Object.freeze({ s01: mode }), watch = observer(Session.prototype, mode, reason);
  let escaped, rejected = false;
  try { await createGitCommand().execute(host.context); } catch (error) { rejected = true; escaped = error; }
  finally { try { const cleanup = await Promise.allSettled(host.cleanups.map(fn => Promise.resolve().then(fn))); assert.ok(cleanup.every(row => row.status === 'fulfilled')); } finally { watch.restore(); } }
  const evidence = { ...watch.snapshot(), rejected, reasonIdentity: escaped === reason, stdoutBytes: Buffer.concat(host.stdout).length, stderrBytes: Buffer.concat(host.stderr).length }; publish(evidence);
  assert.equal(watch.fired, 1); assert.equal(rejected, true); assert.equal(escaped, reason); assert.equal(watch.released.get(watch.slot), 1); assert.equal(watch.live.size, 0); assert.equal(evidence.stdoutBytes, 0); assert.equal(evidence.stderrBytes, 0); return evidence;
});
await record('catalogue-pinning', async publish => {
  const host = await context(), session = new Session(host.context, '/'), catalogue = new PackCatalogue(session), watch = observer(session, 'none');
  let evidence;
  try {
    await catalogue.admit('/repo/.git'); const bodies = [...catalogue.objects.values()].map(object => object.bytes);
    assert.equal(bodies.length, 2); assert.ok(bodies.every(bytes => watch.live.has(bytes)));
    for (const entry of fixture.entries) assert.deepEqual(catalogue.objects.get(entry.oid).bytes, Buffer.from(entry.bodyBase64, 'base64'));
    await session.operation.close(); assert.ok(bodies.every(bytes => watch.live.has(bytes)), 'owned body must not be released at operation close before finish');
    session.finish(); assert.ok(bodies.every(bytes => !watch.live.has(bytes))); assert.ok(bodies.every(bytes => watch.released.get(bytes) === 1)); assert.equal(watch.live.size, 0);
    evidence = { ...watch.snapshot(), verifiedBodies: bodies.length, pinnedThroughOperationClose: true, releasedOnFinish: true }; publish(evidence);
  } finally { try { await session.operation.close(); } finally { try { session.finish(); } finally { watch.restore(); } } }
  return evidence;
});
const summary = { cases, pass: cases.filter(row => row.status === 'PASS').length, fail: cases.filter(row => row.status === 'FAIL').length, qualification: 'Serial source-bound injected faults and observed calls, not native OOM/allocation failure, cap reachability, physical deallocation, native leak or H09 census' };
await fs.writeFile(process.env.GIT_AUTHOR_RESULT, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ pass: summary.pass, fail: summary.fail })); process.exitCode = summary.fail ? 1 : 0;

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { runInNewContext } from 'node:vm';

const owned = path.resolve('tests/compatibility/bash-ere-l02-repair-independent-20260829');
const packet = path.resolve('tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const admitted = [];
let bytesRead = 0;
function read(filename, pin) {
  const before = fs.lstatSync(filename);
  if (!before.isFile() || before.size > 4 * 1024 * 1024) throw Error('TYPE_SIZE ' + filename);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!count) throw Error('SHORT ' + filename);
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || fs.readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length)) throw Error('CHANGED ' + filename);
    bytesRead += bytes.length;
    if (bytesRead > 64 * 1024 * 1024) throw Error('READ_CAP');
    const record = { path: filename, bytes: bytes.length, sha256: hash(bytes) };
    admitted.push(record);
    if (pin && (bytes.length !== (pin.size ?? pin.bytes) || record.sha256 !== pin.sha256)) throw Error('HASH ' + filename);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
const tree = read(path.join(owned, 'evidence-tree.txt')).toString().split('\0').filter(Boolean);
for (const entry of tree) {
  const split = entry.indexOf('\t');
  const [mode, kind, oid] = entry.slice(0, split).split(' ');
  const relative = entry.slice(split + 1);
  if (!['100644', '100755'].includes(mode) || kind !== 'blob' || !relative.startsWith(path.relative(process.cwd(), packet) + '/')) throw Error('TREE_DOMAIN');
  const bytes = read(relative);
  const actual = crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  if (actual !== oid) throw Error('EVIDENCE_BLOB ' + relative);
}
const producer = JSON.parse(read(path.join(packet, 'PRODUCER.json')));
const sources = JSON.parse(read(path.join(packet, 'SOURCES.json'), { size: fs.lstatSync(path.join(packet, 'SOURCES.json')).size, sha256: producer.sourceManifestSha256 }));
const sourcePins = sources.modules.map(row => {
  const bytes = Buffer.from(row.base64, 'base64');
  assert.equal(bytes.length, row.size); assert.equal(hash(bytes), row.sha256);
  if (row.name === 'transport/owner.ts') assert(read(path.join(owned, 'pinned-owner.txt')).equals(bytes));
  if (row.name === 'transport/root.ts') assert(read(path.join(owned, 'pinned-root.txt')).equals(bytes));
  return { name: row.name, bytes: bytes.length, sha256: hash(bytes), sourceCommit: row.sourceCommit };
});
const packageText = read(path.join(packet, 'PACKAGE.tgz.base64.data'), { size: producer.textBytes, sha256: producer.textSha256 });
const compressed = Buffer.from(packageText.toString().trim(), 'base64');
assert.equal(compressed.length, 18000);
assert.equal(hash(compressed), 'dc20c2be0ea41ff11edeef105c9e93ab349a0601a14d77ecc2d6ac984dfb43b0');
const emitted = new Map();
for (const entry of producer.entries.filter(row => row.name.startsWith('ere/'))) {
  emitted.set(entry.name.slice(4), read(path.join(packet, 'BUILD/emitted', entry.name.slice(4)), entry));
}
assert.equal(emitted.size, 24);
const doubleSeal = JSON.parse(read(path.join(packet, 'DOUBLE-PRESEAL-v2.json')));
const replayPath = path.join(packet, 'host-doubles-v2.mjs');
const fakePath = path.join(packet, 'fake-worker.mjs');
const replayOriginal = read(replayPath, doubleSeal.inputs.find(row => row.path === replayPath)).toString();
const replayFake = read(fakePath, doubleSeal.inputs.find(row => row.path === fakePath));
const replayLines = replayOriginal.split('\n');
assert(replayLines[1].includes('registerHooks('));
replayLines[1] = replayLines[1].slice(0, replayLines[1].indexOf('registerHooks('));
const originalOutput = "new URL('./DOUBLE-RESULT-v2.json',import.meta.url)";
assert.equal(replayOriginal.split(originalOutput).length, 2);
const replaySource = replayLines.join('\n').replace(originalOutput, JSON.stringify(path.join(owned, 'replay-result.json')));
assert.equal(replaySource.split('\n').slice(3,22).join('\n'), replayOriginal.split('\n').slice(3,22).join('\n'));
const modules = new Map();
const permitted = ['errors.js', 'limits.js', 'transport/accounting.js', 'transport/owner.js', 'transport/protocol.js', 'transport/root.js', 'transport/validation.js'];
for (const name of permitted) {
  modules.set('l02-replay:///BUILD/emitted/' + name, emitted.get(name));
  modules.set('l02-novel:///' + name, emitted.get(name));
}
modules.set('l02-replay:///host-doubles-v2.mjs', Buffer.from(replaySource));
modules.set('l02-replay:///fake-worker.mjs', replayFake);
modules.set('l02-novel:///fake-worker.mjs', read(path.join(owned, 'fixed-host.mjs')));
const allowedBuiltins = new Set(['node:assert/strict', 'node:module', 'node:fs', 'node:events', 'node:timers/promises', 'node:util']);
const loaded = [];
const replacements = [];
const hooks = registerHooks({
  resolve(specifier, context) {
    if (specifier === 'node:worker_threads') {
      const parent = context.parentURL;
      if (!['l02-replay:///BUILD/emitted/transport/owner.js', 'l02-novel:///transport/owner.js'].includes(parent)) throw Error('WORKER_IMPORTER');
      const url = parent.startsWith('l02-replay:') ? 'l02-replay:///fake-worker.mjs' : 'l02-novel:///fake-worker.mjs';
      replacements.push({ importer: parent, specifier, replacement: url });
      return { url, shortCircuit: true };
    }
    if (specifier.startsWith('node:')) {
      if (!allowedBuiltins.has(specifier)) throw Error('BUILTIN_REFUSED ' + specifier);
      return { url: specifier, shortCircuit: true };
    }
    const url = specifier.startsWith('l02-') ? specifier : new URL(specifier, context.parentURL).href;
    if (!modules.has(url)) throw Error('MODULE_REFUSED ' + url);
    return { url, shortCircuit: true };
  },
  load(url, context, next) {
    if (url.startsWith('node:')) return next(url, context);
    const bytes = modules.get(url);
    if (!bytes) throw Error('LOAD_REFUSED ' + url);
    loaded.push({ url, bytes: bytes.length, sha256: hash(bytes) });
    return { format: 'module', source: bytes, shortCircuit: true };
  },
});
const watchdog = setTimeout(() => {
  fs.writeFileSync(path.join(owned, 'pure-timeout.json'), JSON.stringify({ status: 'PURE_HELPER_TIMEOUT', actualWorkers: 0 }) + '\n');
  process.exit(1);
}, 12000);
const novelty = [];
const retained = [];
const outcome = async promise => { try { return { present: false, value: await promise }; } catch (value) { return { present: true, value }; } };
const reasonRecord = value => value === undefined ? { kind: 'undefined' } : value === null ? { kind: 'null' } : typeof value === 'object' ? { kind: 'object', keys: Reflect.ownKeys(value).filter(key => typeof key === 'string') } : { kind: typeof value, value };
const rejected = (result, expected) => { assert.equal(result.present, true); assert(Object.is(result.value, expected)); };
const ticks = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
try {
  fs.writeFileSync(path.join(owned, 'load-admission.json'), JSON.stringify({ admitted, sourcePins, compressedBytes: compressed.length, compressedSha256: hash(compressed), archiveInflations: 0, emittedFiles: emitted.size, packageEntries: producer.entries.length, replayBodySha256: hash(Buffer.from(replayOriginal.split('\n').slice(3,22).join('\n'))), replayAdaptations: ['replace author loader bootstrap with stricter outer allowlist', 'redirect output to independent owned subtree'], node: { version: process.version, executable: process.execPath } }, null, 2) + '\n');
  await import('l02-replay:///host-doubles-v2.mjs');
  const { EreWorkerOwner } = await import('l02-novel:///transport/owner.js');
  const { EreTransportRoot } = await import('l02-novel:///transport/root.js');
  const { TransportAccounting } = await import('l02-novel:///transport/accounting.js');
  const { configure } = await import('l02-novel:///fake-worker.mjs');
  const bounds = { maxExpansionBytes: 4096, maxExpansionFields: 64 };
  const limits = { patternBytes: 4096, subjectBytes: 4096, work: 131072, states: 512, allocationUnits: 40960, captureBytes: 4096, captureSlots: 64 };
  const input = { pattern: [{ text: 'a', literal: false }], subject: 'a' };
  const owner = options => { const control = configure(options); const instance = new EreWorkerOwner(() => {}, new TransportAccounting(limits)); retained.push(instance, control); return { instance, control }; };
  const makeSignal = () => {
    const listeners = new Set();
    return { aborted: false, reason: undefined, addEventListener(event, listener) { assert.equal(event, 'abort'); listeners.add(listener); }, removeEventListener(event, listener) { assert.equal(event, 'abort'); listeners.delete(listener); }, abort(reason) { this.aborted = true; this.reason = reason; for (const listener of listeners) listener(); }, get listenerCount() { return listeners.size; } };
  };
  const rootCase = async (options, signal, cancel, expected) => {
    const control = configure(options);
    const root = new EreTransportRoot(bounds, () => {});
    const session = root.openSession(() => {});
    retained.push(root, session, control, signal);
    const request = outcome(session.execute(input, signal));
    if (cancel) signal.abort(expected);
    rejected(await request, expected);
    const before = root.usage;
    rejected(await outcome(root.close()), expected);
    rejected(await outcome(session.close()), expected);
    const after = root.usage;
    assert.equal(root.retirementState, 'UNCONFIRMED');
    assert.equal(after.transport.live, before.transport.live);
    assert.equal(after.transport.reserved, before.transport.reserved);
    assert.equal(after.engine.unknown, before.engine.unknown);
    assert.equal(control.workers.length, 1);
    assert.equal(control.terminations, 1);
    assert.equal((await outcome(session.execute(input))).present, true);
    if (signal) assert.equal(signal.listenerCount, 1);
    return { retirement: root.retirementState, primary: reasonRecord(expected), before, after, events: control.events, retainedCancelListeners: signal?.listenerCount };
  };
  const test = async (id, body) => {
    try { novelty.push({ id, pass: true, observation: await body() }); }
    catch (reason) { novelty.push({ id, pass: false, reason: reasonRecord(reason), message: reason instanceof Error ? reason.message : undefined }); }
  };
  await test('N01-setup-undefined-cleanup-zero', () => rootCase({ single: true, setup: undefined, rejectCleanup: true, cleanup: 0 }, undefined, false, undefined));
  await test('N02-setup-null-cleanup-false', () => rootCase({ single: true, setup: null, rejectCleanup: true, cleanup: false }, undefined, false, null));
  await test('N03-setup-zero-cleanup-null', () => rootCase({ single: true, setup: 0, rejectCleanup: true, cleanup: null }, undefined, false, 0));
  await test('N04-caller-zero-over-setup-false', () => rootCase({ single: true, setup: false, rejectCleanup: true, cleanup: undefined }, makeSignal(), true, 0));
  await test('N05-caller-undefined-over-setup-null', () => rootCase({ single: true, setup: null, rejectCleanup: true, cleanup: false }, makeSignal(), true, undefined));
  await test('N06-cross-realm-own-data-cleanup-null', async () => {
    const ready = runInNewContext('({version:1,operation:"shell-ere",kind:"ready"})');
    const { instance, control } = owner({ ready, rejectCleanup: true, cleanup: null });
    await instance.start(); rejected(await outcome(instance.close()), null);
    assert.equal(instance.retirementState, 'UNCONFIRMED'); assert.equal(instance.cleanupFailurePresent, true); assert.equal(instance.cleanupFailureReason, null);
    return { retirement: instance.retirementState, ownKeys: Reflect.ownKeys(ready), ownData: Reflect.ownKeys(ready).every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(ready,key), 'value')), events: control.events };
  });
  await test('N07-pending-terminate-is-not-rejected', async () => {
    const { instance, control } = owner({ pending: true });
    await instance.start(); let settled = false;
    const closing = instance.close(); const observed = outcome(closing).then(result => { settled = true; return result; });
    try {
      await ticks(); assert.equal(settled, false); assert.equal(instance.retirementState, 'PENDING'); assert.equal(instance.cleanupFailurePresent, false); assert.equal(instance.close(), closing);
    } finally { control.complete(); }
    assert.equal((await observed).present, false); assert.equal(instance.retirementState, 'RETIRED');
    return { pendingObserved: true, finalRetirement: instance.retirementState, events: control.events };
  });
  await test('N08-pending-streams-remain-pending', async () => {
    const { instance, control } = owner({ pendingStreams: true });
    await instance.start(); let settled = false;
    const observed = outcome(instance.close()).then(result => { settled = true; return result; });
    try { await ticks(); assert.equal(settled, false); assert.equal(instance.retirementState, 'PENDING'); }
    finally { control.workers[0].stdout.finish(); control.workers[0].stderr.finish(); }
    assert.equal((await observed).present, false); assert.equal(instance.retirementState, 'RETIRED');
    return { pendingStreamsObserved: true, finalRetirement: instance.retirementState, events: control.events };
  });
  await test('N09-rejection-after-observed-retirement', async () => {
    const { instance, control } = owner({ observedRejection: true, cleanup: false });
    await instance.start(); rejected(await outcome(instance.close()), false);
    assert.equal(instance.retirementState, 'RETIRED'); assert.equal(instance.cleanupFailurePresent, true); assert.equal(instance.cleanupFailureReason, false);
    rejected(await outcome(control.termination), false);
    return { retirement: instance.retirementState, cleanup: reasonRecord(instance.cleanupFailureReason), events: control.events };
  });
  await test('N10-independent-streams-first-failure-order', async () => {
    const { instance, control } = owner({ single: true, setup: false, streamFaults: { stdout: 0, stderr: null } });
    rejected(await outcome(instance.start()), false); rejected(await outcome(instance.close()), false);
    assert.equal(instance.cleanupFailurePresent, true); assert.equal(instance.cleanupFailureReason, 0); assert.equal(instance.retirementState, 'UNCONFIRMED');
    assert(control.events.indexOf('stdout:enroll:end') < control.events.indexOf('stderr:enroll:end'));
    assert(control.events.includes('stderr:enroll:end'));
    return { retirement: instance.retirementState, setup: reasonRecord(false), firstCleanup: reasonRecord(0), events: control.events };
  });
  const replay = JSON.parse(read(path.join(owned, 'replay-result.json')));
  assert.equal(replay.groups.length, 16);
  assert.equal(novelty.length, 10);
  const output = { schema: 'l02-independent-pure-v1', at: new Date().toISOString(), sourceCommit: '4abbdeec8e34de88ed2cf7bd32be9c06b413c631', replay: { count: 16, passed: replay.passed }, novel: { count: 10, passed: novelty.filter(row => row.pass).length, rows: novelty }, actualWorkers: 0, matchingCalls: 0, publicShellCalls: 0, loaded, replacements, retainedModelReferences: retained.length, qualification: 'Fixed host doubles only; rejected/pending/retired distinctions are not native Worker telemetry.' };
  fs.writeFileSync(path.join(owned, 'pure-result.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ at: output.at, replay: output.replay, novel: { count: 10, passed: output.novel.passed }, failures: novelty.filter(row => !row.pass), loadedPrivateModules: loaded.filter(row => row.url.endsWith('.js')).length, actualWorkers: 0 }, null, 2));
  if (replay.passed !== 16 || output.novel.passed !== 10) process.exitCode = 1;
} finally { clearTimeout(watchdog); hooks.deregister(); }

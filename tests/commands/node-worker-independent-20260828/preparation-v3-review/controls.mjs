import assert from 'node:assert/strict';
import { createParentRpc } from './parent-rpc.mjs';
import * as wire from './wire.mjs';
import { Reservations } from './reservations.mjs';
import { jsonSize } from './json-size.mjs';

const results = [];
async function check(id, action) {
  try { await action(); results.push({ id, pass: true }); }
  catch (error) { results.push({ id, pass: false, message: String(error?.message ?? error) }); }
}
function ownerModel() {
  let open = true;
  const records = [];
  const failures = [];
  const owner = {
    signal: new AbortController().signal, failures,
    isOpen: () => open, event() {}, admit: () => 1,
    cutoff() { open = false; }, requestTermination() {},
    fail(value, provenance) { failures.push({ value, provenance }); open = false; },
    registerCleanup(callback) {
      let completion;
      const run = () => completion ??= Promise.resolve().then(callback).catch(value => {
        owner.fail(value, 'cleanup'); throw value;
      });
      records.push(run);
      return run;
    },
    async close() { open = false; for (const run of records) await run().catch(() => {}); }
  };
  return owner;
}
function setup(options = {}) {
  const sab = new SharedArrayBuffer(wire.SAB_BYTES);
  const parent = wire.views(sab, 7, true);
  const producer = wire.views(sab, 7);
  const owner = ownerModel();
  const ledger = new Reservations();
  const fixture = {
    namespace: 1,
    authorize: options.authorize ?? (() => true),
    start: options.start ?? (() => ({ result: Promise.resolve(null), close: async () => {} }))
  };
  const rpc = createParentRpc(parent, owner, fixture, ledger, options.recognize ?? null);
  async function send(phase, tag, total, offset, bytes, initial = false) {
    if (initial) Atomics.store(producer.header, 0, wire.STATES.WORKER);
    const frame = wire.publish(producer, wire.STATES.WORKER,
      initial ? wire.STATES.REQUEST : wire.STATES.ACK, 1, phase, tag, total, offset, bytes);
    await rpc.doorbell({ seq: 1, frame });
  }
  async function begin(op = 'authorizeModule', authority = 'module', total = 0) {
    const metadata = { v: wire.VERSION, session: 7, slot: 0, seq: 1, op, authority,
      path: authority === 'data' ? '/data/file' : null,
      flag: op === 'readText' ? 'r' : op === 'writeText' ? 'w' : null,
      totalBytes: op === 'readText' ? null : total,
      moduleKey: op === 'authorizeModule' ? 'fs' : null };
    await send(wire.PHASES.HEADER, wire.TAGS.none, total, 0, wire.encode(metadata), true);
  }
  function receive() { return wire.acquire(producer, wire.STATES.RESPONSE, wire.STATES.WORKER, 1); }
  async function finishEmpty() {
    const frame = receive();
    await send(wire.PHASES.FINAL_ACK, frame.tag, 0, 0, new Uint8Array());
  }
  return { parent, producer, owner, ledger, rpc, begin, send, receive, finishEmpty };
}
function typedReason() {
  return { name: 'FsError', code: 'ENOENT', message: 'missing', errno: -2,
    path: undefined, syscall: undefined, dest: undefined };
}
await check('S1a', async () => {
  const reason = Object.freeze({ authorization: false });
  const state = setup({ authorize() { throw reason; } });
  await assert.rejects(state.begin(), value => value === reason);
  assert.equal(state.ledger.live, 12 * 1048576);
  await state.owner.close();
  assert.equal(state.ledger.live, 0);
});
await check('S1b', async () => {
  const state = setup();
  await state.begin(); await state.finishEmpty();
  const active = state.rpc.outcomes.get(1).active;
  assert.equal(state.ledger.entries.has('operation-1'), true);
  assert.equal(active.upload, null); assert.equal(active.resultBytes, null);
  const release = state.ledger.release.bind(state.ledger);
  state.ledger.release = key => {
    if (key === 'operation-1') for (const name of ['upload', 'resultBytes', 'operation', 'metadata', 'request']) assert.equal(active[name], null);
    return release(key);
  };
  state.rpc.delivery({ seq: 1 });
  assert.equal(state.ledger.entries.has('operation-1'), false);
  assert.equal(state.rpc.outcomes.get(1).active, null);
  assert.throws(() => state.rpc.delivery({ seq: 1 }));
  await state.owner.close(); assert.equal(state.ledger.live, 0);
});
await check('S1c', async () => {
  const state = setup({ start: () => ({ result: Promise.resolve(new Uint8Array(1048576)), close: async () => {} }) });
  await state.begin('readText', 'data');
  assert.equal(state.owner.failures.length, 1);
  assert.equal(state.owner.failures[0].value.message, 'reservation refused');
  assert.equal(state.rpc.outcomes.size, 0);
  assert.equal(jsonSize('\0'.repeat(1048576), 6 * 1048576 + 2), 6 * 1048576 + 2);
  await state.owner.close(); assert.equal(state.ledger.live, 0);
});
await check('S2a', async () => {
  const reason = typedReason();
  const state = setup({ start() { throw reason; }, recognize: value => value === reason });
  await state.begin('readText', 'data'); await state.finishEmpty();
  await state.owner.close(); state.rpc.reconcile(); state.rpc.reconcile();
  assert.equal(state.owner.failures.length, 1);
  assert.equal(state.owner.failures[0].value, reason);
  assert.equal(state.owner.failures[0].provenance, 'undelivered-parent');
});
await check('S2b', async () => {
  const reason = typedReason();
  const state = setup({ start() { throw reason; }, recognize: value => value === reason });
  await state.begin('readText', 'data'); await state.finishEmpty();
  assert.throws(() => state.rpc.terminal({ lastSeq: 1, finalFrame: state.parent.lastFrame, deliveredSeq: 1 }));
  state.rpc.delivery({ seq: 1 }); state.rpc.reconcile();
  assert.equal(state.owner.failures.length, 0); await state.owner.close();
});
await check('S3a', async () => {
  const reason = false;
  const state = setup({ start: () => ({ result: Promise.resolve(null), close: async () => { throw reason; } }) });
  await state.begin(); await assert.rejects(state.finishEmpty(), value => value === reason);
  assert.equal(state.rpc.outcomes.get(1).closed, false);
  assert.notEqual(Atomics.load(state.parent.header, 0), wire.STATES.FREE);
  assert.equal(state.owner.failures[0].value, reason);
  await state.owner.close();
  assert.equal(state.ledger.entries.has('operation-1'), true);
});
await check('S4a', () => {
  let observed = 0;
  assert.throws(() => wire.control({ get kind() { observed += 1; return 'ready'; } }, 7));
  assert.throws(() => wire.control({ kind: { toString() { observed += 1; return 'ready'; } } }, 7));
  assert.throws(() => wire.control({ v: wire.VERSION, session: 7, kind: 'ready', extra: 1 }, 7));
  assert.equal(observed, 0);
  assert.equal(wire.control({ v: wire.VERSION, session: 7, kind: 'ready' }, 7).kind, 'ready');
});
await check('S4b', () => {
  for (const [published, phase, tag, length] of [
    [wire.STATES.REQUEST, wire.PHASES.HEADER, wire.TAGS.none, 8193],
    [wire.STATES.REQUEST, wire.PHASES.HEADER, 99, 0],
    [wire.STATES.ACK, wire.PHASES.FINAL_ACK, wire.TAGS.void, 1]
  ]) {
    const state = setup(); let copies = 0;
    state.parent.payload = { buffer: state.parent.payload.buffer, subarray() { copies += 1; throw new Error('copy'); } };
    state.parent.header.set([published, 1, phase, 1, 0, length, 0, tag, 0]);
    assert.throws(() => wire.acquire(state.parent, published, wire.STATES.PARENT, 1));
    assert.equal(copies, 0);
  }
});
await check('S4c', async () => {
  let effects = 0;
  const state = setup({ start() { effects += 1; throw new Error('unexpected effect'); } });
  await state.begin('writeText', 'data', 1); state.receive();
  await assert.rejects(state.send(wire.PHASES.UPLOAD, wire.TAGS.upload, 1, 0, Uint8Array.of(255)));
  assert.equal(effects, 0); await state.owner.close(); assert.equal(state.ledger.live, 0);
});
await check('S6a', async () => {
  const reason = typedReason(); let recognitions = 0;
  const state = setup({ start() { throw reason; }, recognize() { recognitions += 1; return true; } });
  await state.begin('writeOutput', 'stdout');
  assert.equal(recognitions, 0); assert.equal(state.rpc.outcomes.size, 0);
  assert.equal(state.owner.failures[0].value, reason); await state.owner.close();
});
process.stdout.write(JSON.stringify({ qualification: 'actual five frozen helpers; synthetic owner/provider; zero Worker/engine/compiler/guest', results }) + '\n');
process.exitCode = results.every(row => row.pass) ? 0 : 1;

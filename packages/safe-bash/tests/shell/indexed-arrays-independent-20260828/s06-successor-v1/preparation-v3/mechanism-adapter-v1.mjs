import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ArrayLedger, ArrayOwner } from './node_modules/virtual-bash/dist/shell/arrays/ledger.js';
import { BindingStore, IndexedBinding, textToken } from './node_modules/virtual-bash/dist/shell/arrays/bindings.js';
import { StateMonitor } from './node_modules/virtual-bash/dist/shell/arrays/state.js';
import { installTerminalObserver } from './observer-v2.mjs';
import { overlayCases } from './semantic.mjs';

export const candidate = 'c0adae539c736db0e4023d401562ce958d9ebb00';
export const supportedIds = ['M01','M02','M03','M04','M05','M06','M07','M09','M10','M11','M12','M13','M14','M15','M18','M19','M20'];
const signal = new AbortController().signal;
const loaded = ['ledger', 'bindings', 'state'].map(name => {
  const path = fileURLToPath(new URL(`./node_modules/virtual-bash/dist/shell/arrays/${name}.js`, import.meta.url));
  return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
});
export async function execute({ id, api }) {
  assert.ok(supportedIds.includes(id));
  let ledger, owner; const detail = { category: 'actual-candidate-mechanism', requiredLoads: loaded, origin: 'direct loaded private helpers unless explicitly marked integrated Runtime', publicBoundaryProof: false };
  const create = (bytes = 4096, fields = 128, initial = 0) => { ledger = new ArrayLedger(bytes, fields, initial); owner = ArrayOwner.create(ledger); return owner; };
  try {
    if (id === 'M01' || id === 'M02') {
      ledger = new ArrayLedger(4096, 64, Number.MAX_SAFE_INTEGER - (id === 'M01' ? 2 : 3));
      const before = ledger.snapshot();
      if (id === 'M01') {
        assert.throws(() => ledger.reserve({ generation: true, version: true, epoch: true }), /private epoch capacity exhausted/u);
        assert.deepEqual(ledger.snapshot(), before);
      } else {
        const admission = ledger.reserve({ generation: true, version: true, epoch: true });
        assert.deepEqual([admission.generation, admission.version, admission.epoch], [Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]);
        admission.release(); assert.equal(ledger.snapshot().lastIssued, Number.MAX_SAFE_INTEGER);
        assert.throws(() => ledger.reserve({ epoch: true }), /private epoch capacity exhausted/u);
      }
      detail.constructorInitialTicketIsPrivateTestHook = true;
    } else if (id === 'M03') {
      create(4096, 128, 3); const store = BindingStore.create(owner), operation = ArrayOwner.create(ledger, owner);
      const binding = IndexedBinding.create(owner); binding.insert(0, await textToken(binding.owner, 'x', signal));
      const prepared = await store.prepareName('a', operation, signal), saved = operation.reserve({ generation: true, version: true, epoch: true });
      await store.publish('a', binding, saved, prepared);
      const middle = operation.reserve({ generation: true, version: true, epoch: true }); store.changed(middle, 'a');
      const current = operation.reserve({ generation: true, version: true, epoch: true }); store.changed(current, 'a');
      assert.deepEqual([saved.generation, saved.version, saved.epoch], [4, 5, 6]); assert.deepEqual([current.generation, current.version, current.epoch], [10, 11, 12]);
      store.changed(saved, 'a'); assert.deepEqual([binding.generation, binding.version, store.epoch], [4, 5, 6]);
      const next = store.tickets('a'); assert.deepEqual([next.generation, next.version, next.epoch], [13, 14, 15]);
      detail.coverage = 'old ticket publication equality and monotonic allocator; not the full local-restoration scheduling path';
    } else if (id === 'M04' || id === 'M05') {
      create(); const store = BindingStore.create(owner), operation = ArrayOwner.create(ledger, owner);
      const watch = await store.watch('a', operation, signal); assert.equal(watch.valid(), true);
      if (id === 'M05') {
        const publish = async () => {
          const binding = IndexedBinding.create(owner); binding.insert(0, await textToken(binding.owner, 'x', signal));
          const prepared = await store.prepareName('a', operation, signal), tickets = store.tickets('a'); await store.publish('a', binding, tickets, prepared);
        };
        await publish(); assert.equal(watch.valid(), false); const first = store.get('a').generation;
        await store.remove('a', store.tickets('a')); assert.equal(store.get('a'), undefined);
        await publish(); assert.equal(store.get('a').get(0), 'x'); assert.ok(store.get('a').generation > first); assert.equal(watch.valid(), false);
      }
      const before = ledger.snapshot(); assert.equal(store.watches.size, 1); watch.close(); assert.equal(store.watches.size, 0); watch.close();
      assert.ok(ledger.snapshot().used[1] < before.used[1]); assert.ok(ledger.snapshot().used[2] < before.used[2]);
    } else if (id === 'M06') {
      create(); const text = await textToken(owner, '1234567', signal); text.retain();
      const before = ledger.snapshot(); assert.equal(text.references, 2); text.release(); assert.equal(ledger.snapshot().used[2], 7);
      text.release(); assert.equal(ledger.snapshot().used[2], 0); assert.deepEqual(ledger.snapshot().used.slice(4), before.used.slice(4));
    } else if (id === 'M07') {
      create(); const children = Array.from({ length: 26 }, () => ArrayOwner.create(ledger, owner)); const before = ledger.snapshot();
      const first = owner.close(); assert.equal(owner.close(), first); assert.equal(owner.close(), first); await first;
      assert.equal(children.every(child => child.header.released), true); assert.equal(owner.header.released, true);
      assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]); assert.deepEqual(ledger.snapshot().used.slice(4), before.used.slice(4));
      detail.distinctOwners = 27; detail.coverage = 'actual single-flight Promise and retirement; enqueue-allocation bound remains source-proof obligation';
    } else if (id === 'M09') {
      detail.origin = 'actual public Shell local and middleware overlay paths';
      detail.overlay = await overlayCases(api, true);
      const shell = new api.Shell({ fs: new api.MemoryFileSystem() }), calls = [];
      shell.register({ name: '__capture', execute(context) { calls.push([...context.args]); return { exitCode: 0 }; } });
      try {
        const result = await shell.exec('a=([7]=outer); f() { local a; a[2]=inner; readonly a; __capture "${a[2]}"; }; f; __capture "${#a[@]}" "${a[7]}"');
        assert.equal(result.exitCode, 0); assert.equal(result.stderr, ''); assert.deepEqual(calls, [['inner'], ['1', 'outer']]); detail.calls = calls;
      } finally { await shell.dispose(); }
    } else if (id === 'M10') {
      ledger = new ArrayLedger(0, 64); assert.equal(ledger.active, false); owner = ArrayOwner.create(ledger);
      await assert.rejects(textToken(owner, 'a', signal), /private payload limit exceeded/u); assert.equal(ledger.snapshot().used[2], 0);
      detail.coverage = 'lazy private constructor and owned-name payload refusal; not a scalar public zero-budget acceptance claim';
    } else if (id === 'M11') {
      ledger = new ArrayLedger(4096, 0); const before = ledger.snapshot();
      assert.throws(() => ArrayOwner.create(ledger), /private metadata limit exceeded/u); assert.deepEqual(ledger.snapshot(), before);
    } else if (id === 'M12') {
      create(4096, 1); const before = ledger.snapshot(); assert.equal(before.used[3], 128);
      assert.throws(() => BindingStore.create(owner), /private metadata limit exceeded/u); assert.deepEqual(ledger.snapshot(), before);
    } else if (id === 'M13') {
      ledger = new ArrayLedger(Number.MAX_SAFE_INTEGER, 0); const before = ledger.snapshot();
      assert.throws(() => ledger.reserve(), /private allocated byte capacity is not representable/u); assert.deepEqual(ledger.snapshot(), before);
    } else if (id === 'M14') {
      const small = new ArrayLedger(4096, 4), slots = small.reserve({ slots: 4 });
      assert.throws(() => small.reserve({ slots: 1 }), /private Map slot limit exceeded/u); slots.release();
      create(4096, 128); const store = BindingStore.create(owner), operation = ArrayOwner.create(ledger, owner);
      owner.reserve({ slots: 128 });
      await assert.rejects(store.watch('a', operation, signal), /private Map slot limit exceeded/u); assert.equal(store.watches.size, 0); assert.equal(ledger.snapshot().used[2], 0);
      detail.coverage = 'frozen4-slot direct limit plus actual128-slot watch admission; metadata makes literal4-slot full store inapplicable';
    } else if (id === 'M15') {
      ledger = new ArrayLedger(4096, 64);
      for (let index = 0; index < 10; index++) ledger.reserve().release();
      const before = ledger.snapshot();
      assert.throws(() => ledger.reserve({ metadata: 8193, work: 147457 }), /private metadata limit exceeded/u); assert.deepEqual(ledger.snapshot(), before);
      detail.coverage = 'ten actual prior reservations:640 cumulative bytes and150 work; model scalar10 not relabeled as actual charged work';
    } else if (id === 'M18') {
      detail.origin = 'actual Runtime ledgers from two public execs, each with three internal invokes';
      let phase = 0;
      const observer = installTerminalObserver({ monitorPrototype: StateMonitor.prototype, ownerPrototype: ArrayOwner.prototype, ownerFor: monitor => monitor.session.owner, isRoot: value => value.parent === undefined, capture: monitor => ({ phase, ledger: monitor.session.ledger }), terminal: observation => observation });
      const shell = new api.Shell({ fs: new api.MemoryFileSystem() });
      shell.register({ name: '__walk', async execute(context) { const depth = Number(context.args[0]); if (depth) return context.invoke('__walk', [String(depth - 1)]); return { exitCode: 0 }; } });
      try {
        for (phase = 0; phase < 2; phase++) { const result = await shell.exec('a=([0]=x); __walk 3'); assert.equal(result.exitCode, 0); assert.equal(result.stderr, ''); }
        const observation = await observer.after(); assert.equal(observation.roots.length, 2);
        const groups = [0, 1].map(label => observation.captures.filter(row => row.phase === label));
        for (const group of groups) { assert.equal(group.length, 4); assert.ok(group.every(row => row.ledger === group[0].ledger)); }
        assert.notEqual(groups[0][0].ledger, groups[1][0].ledger);
        detail.monitorsPerExec = groups.map(group => group.length); detail.ledgers = groups.map(group => group[0].ledger.snapshot());
        for (const snapshot of detail.ledgers) assert.deepEqual(snapshot.used.slice(0, 4), [0, 0, 0, 0]);
      } finally { await shell.dispose(); await observer.close(); }
    } else if (id === 'M19') {
      create(); const charges = [], original = owner.reserve;
      owner.reserve = function (charge) { charges.push({ ...charge }); return Reflect.apply(original, this, [charge]); };
      const tokens = [];
      try {
        for (const text of ['a', '😀', '\ud800']) tokens.push(await textToken(owner, text, signal));
        assert.deepEqual(tokens.map(token => token.bytes), [1, 4, 3]);
        assert.deepEqual(charges.filter(charge => Object.keys(charge).length === 1 && Object.hasOwn(charge, 'work')).map(charge => charge.work), [1, 2, 1]);
        tokens.push(await textToken(owner, '😀', signal)); assert.equal(ledger.snapshot().used[2], 12);
      } finally { delete owner.reserve; for (const token of tokens) token.release(); }
    } else if (id === 'M20') {
      ledger = new ArrayLedger(4096, 64);
      const admission = ledger.reserve({ metadata: 2496, payload: 50, slots: 21, work: 430 });
      assert.deepEqual(ledger.snapshot().used.slice(1), [21, 50, 2560, 2610, 21, 445]);
      admission.release(); admission.release(); assert.deepEqual(ledger.snapshot().used, [0, 0, 0, 0, 2610, 21, 445]);
      detail.coverage = 'exact numerical reference release/nonrefund through actual ledger; not reference graph allocation implementation';
    }
    detail.snapshot = ledger?.snapshot(); detail.assertionsCompleted = true;
  } finally {
    if (owner) {
      try { await owner.close(); assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]); }
      catch (error) { throw Object.assign(new Error(`mechanism owner cleanup failed: ${String(error)}`), { unsafe: true }); }
    }
  }
  detail.disposed = true; return detail;
}

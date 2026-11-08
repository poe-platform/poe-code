import assert from "node:assert/strict";
import test from "node:test";
import { shellValueBytes, shellValueFromBytes } from "../../../../src/contracts/value.js";
import type { ShellValue } from "../../../../src/contracts/value.js";
import { BindingStore, IndexedBinding, textToken } from "../../../../src/shell/arrays/bindings.js";
import { ArrayLedger, ArrayOwner } from "../../../../src/shell/arrays/ledger.js";
import { requireArrays, stateMonitor, trackState } from "../../../../src/shell/arrays/state.js";
import { InvocationScope } from "../../../../src/shell/cleanup.js";
import type { State } from "../../../../src/shell/runtime.js";
import { ValueArena } from "../../../../src/shell/value-state.js";

const signal = new AbortController().signal;

test("indexed cells preserve owned raw bytes and keep the text compatibility view", async () => {
  const ledger = new ArrayLedger(4096, 128);
  const owner = ArrayOwner.create(ledger);
  try {
    const binding = IndexedBinding.create(owner);
    const input = Uint8Array.of(0xff, 0, 0xfe);
    const value = shellValueFromBytes(input);
    const token = await textToken(binding.owner, value, signal);
    binding.insert(9, token);
    input.fill(65);
    assert.equal(binding.get(9), "\ufffd\0\ufffd");
    assert.equal(binding.getValue(9), value);
    assert.deepEqual(shellValueBytes(binding.getValue(9)!), Uint8Array.of(0xff, 0, 0xfe));
    const output = shellValueBytes(binding.getValue(9)!);
    output.fill(66);
    assert.deepEqual(shellValueBytes(binding.getValue(9)!), Uint8Array.of(0xff, 0, 0xfe));
    assert.equal(token.bytes, 3);
    assert.equal(ledger.snapshot().used[2], 3);
    assert.equal(binding.getValue(0), undefined);
  } finally { await owner.close(); }
  assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
});

test("indexed cells do not infer raw provenance from equal display strings", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(4096, 128));
  try {
    const binding = IndexedBinding.create(owner);
    for (const [index, value] of [shellValueFromBytes(Uint8Array.of(255)), shellValueFromBytes(Uint8Array.of(254)), "\ufffd", ""].entries()) {
      binding.insert(index, await textToken(binding.owner, value, signal));
    }
    assert.equal(binding.get(0), binding.get(1));
    assert.equal(binding.get(1), binding.get(2));
    assert.deepEqual([0, 1, 2, 3].map(index => Buffer.from(shellValueBytes(binding.getValue(index)!)).toString("hex")), ["ff", "fe", "efbfbd", ""]);
  } finally { await owner.close(); }
});

test("copied cells keep payload charged after their original binding closes", async () => {
  const ledger = new ArrayLedger(4096, 128);
  const owner = ArrayOwner.create(ledger);
  try {
    const original = IndexedBinding.create(owner);
    const token = await textToken(original.owner, "payload", signal);
    original.insert(7, token);
    const copy = await original.copy(signal);
    assert.equal(token.references, 2);
    await original.release();
    assert.equal(copy.get(7), "payload");
    assert.equal(token.references, 1);
    assert.equal(token.admission.released, false);
    assert.equal(ledger.snapshot().used[2], 7);
    await copy.release();
    assert.equal(token.admission.released, true);
    assert.equal(ledger.snapshot().used[2], 0);
  } finally { await owner.close(); }
});

test("raw copy-on-write preserves the retained old value until both owners release", async () => {
  const ledger = new ArrayLedger(4096, 128);
  const owner = ArrayOwner.create(ledger);
  try {
    const original = IndexedBinding.create(owner);
    const first = await textToken(original.owner, shellValueFromBytes(Uint8Array.of(255)), signal);
    original.insert(0, first);
    const copy = await original.copy(signal);
    copy.insert(0, await textToken(copy.owner, shellValueFromBytes(Uint8Array.of(254)), signal));
    assert.deepEqual(shellValueBytes(original.getValue(0)!), Uint8Array.of(255));
    assert.deepEqual(shellValueBytes(copy.getValue(0)!), Uint8Array.of(254));
    assert.equal(ledger.snapshot().used[2], 2);
    await copy.release();
    assert.equal(first.admission.released, false);
    assert.equal(ledger.snapshot().used[2], 1);
    await original.release();
    assert.equal(ledger.snapshot().used[2], 0);
  } finally { await owner.close(); }
});

test("cell transfer survives closure of the staging operation", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(4096, 128));
  try {
    const operation = ArrayOwner.create(owner.ledger, owner);
    const binding = IndexedBinding.create(owner);
    const token = await textToken(operation, "staged", signal);
    binding.insert(0, token);
    await operation.close();
    assert.equal(token.admission.released, false);
    assert.equal(binding.get(0), "staged");
    await binding.release();
    assert.equal(token.admission.released, true);
  } finally { await owner.close(); }
});

test("cell insertion rejects foreign and released ownership without changing the destination", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(4096, 128));
  const foreign = ArrayOwner.create(new ArrayLedger(4096, 128));
  try {
    const binding = IndexedBinding.create(owner);
    binding.insert(0, await textToken(binding.owner, "original", signal));
    const token = await textToken(foreign, "foreign", signal);
    assert.throws(() => binding.insert(0, token));
    assert.equal(binding.get(0), "original");
    assert.equal(token.references, 1);
    const released = await textToken(binding.owner, "released", signal);
    released.release();
    assert.throws(() => binding.insert(0, released));
    assert.throws(() => released.retain());
    assert.equal(binding.get(0), "original");
  } finally { await owner.close(); await foreign.close(); }
});

test("raw cells charge their actual bytes rather than replacement-text length", async () => {
  const ledger = new ArrayLedger(1, 128);
  const owner = ArrayOwner.create(ledger);
  try {
    const binding = IndexedBinding.create(owner);
    binding.insert(0, await textToken(binding.owner, shellValueFromBytes(Uint8Array.of(255)), signal));
    const before = ledger.snapshot().used.slice(0, 4);
    await assert.rejects(textToken(binding.owner, shellValueFromBytes(Uint8Array.of(254)), signal), /payload limit/);
    assert.deepEqual(ledger.snapshot().used.slice(0, 4), before);
    assert.deepEqual(shellValueBytes(binding.getValue(0)!), Uint8Array.of(255));
  } finally { await owner.close(); }
});

test("foreign byte brands fail before retaining any array payload", async () => {
  const ledger = new ArrayLedger(4096, 128);
  const owner = ArrayOwner.create(ledger);
  try {
    const before = ledger.snapshot().used.slice(0, 4);
    await assert.rejects(textToken(owner, Object.freeze({}) as ShellValue, signal), /owned shell byte value/);
    assert.deepEqual(ledger.snapshot().used.slice(0, 4), before);
  } finally { await owner.close(); }
});

test("cancelled empty and byte preparation preserves falsey reasons without admissions", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(4096, 128));
  try {
    for (const reason of [false, 0, "", null]) {
      const controller = new AbortController();
      controller.abort(reason);
      const before = owner.ledger.snapshot().used.slice(0, 4);
      for (const value of ["", shellValueFromBytes(Uint8Array.of(255))]) {
        await assert.rejects(textToken(owner, value, controller.signal), error => error === reason);
      }
      assert.deepEqual(owner.ledger.snapshot().used.slice(0, 4), before);
    }
  } finally { await owner.close(); }
});

test("cancelled copying releases the partial clone and preserves the original", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(4096, 128));
  try {
    const original = IndexedBinding.create(owner);
    original.insert(0, await textToken(original.owner, "original", signal));
    const before = owner.ledger.snapshot().used.slice(0, 4);
    const controller = new AbortController();
    controller.abort(false);
    await assert.rejects(original.copy(controller.signal), error => error === false);
    assert.equal(original.references, 1);
    assert.equal(original.get(0), "original");
    assert.deepEqual(owner.ledger.snapshot().used.slice(0, 4), before);
  } finally { await owner.close(); }
});

test("prepared publication transfers raw cells and retires all temporary ownership", async () => {
  const ledger = new ArrayLedger(4096, 128);
  const owner = ArrayOwner.create(ledger);
  try {
    const store = BindingStore.create(owner);
    const prepared = await store.prepare("array", signal);
    try {
      prepared.binding.insert(4, await textToken(prepared.binding.owner, shellValueFromBytes(Uint8Array.of(255)), signal));
      assert.equal(store.get("array"), undefined);
      prepared.validate();
      await prepared.publish();
      assert.equal(store.get("array"), prepared.binding);
      assert.throws(() => prepared.publish(), /publication/);
    } finally { await prepared.close(); }
    assert.equal(store.watches.size, 0);
    assert.deepEqual(shellValueBytes(store.get("array")!.getValue(4)!), Uint8Array.of(255));
    assert.equal(ledger.snapshot().used[2], 6);
  } finally { await owner.close(); }
  assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
});

test("discarded preparations preserve the old binding and release staging charges", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(4096, 256));
  try {
    const store = BindingStore.create(owner);
    const initial = await store.prepare("array", signal);
    try {
      initial.binding.insert(0, await textToken(initial.binding.owner, "old", signal));
      await initial.publish();
    } finally { await initial.close(); }
    const before = owner.ledger.snapshot().used.slice(0, 4);
    const discarded = await store.prepare("array", signal);
    try {
      assert.equal(discarded.binding.get(0), "old");
      discarded.binding.insert(0, await textToken(discarded.binding.owner, "new", signal));
      assert.equal(store.get("array")!.get(0), "old");
    } finally { await discarded.close(); }
    assert.equal(discarded.close(), discarded.close());
    assert.throws(() => discarded.publish(), /publication/);
    assert.deepEqual(owner.ledger.snapshot().used.slice(0, 4), before);
  } finally { await owner.close(); }
});

test("competing publications invalidate the earlier generation without overwriting the winner", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(4096, 256));
  try {
    const store = BindingStore.create(owner);
    const earlier = await store.prepare("array", signal);
    const later = await store.prepare("array", signal);
    try {
      earlier.binding.insert(0, await textToken(earlier.binding.owner, "earlier", signal));
      later.binding.insert(0, await textToken(later.binding.owner, "later", signal));
      await later.publish();
      assert.throws(() => earlier.validate(), /changed/);
      assert.throws(() => earlier.publish(), /changed/);
      assert.equal(store.get("array")!.get(0), "later");
    } finally { await earlier.close(); await later.close(); }
    assert.equal(store.watches.size, 0);
    assert.equal(owner.ledger.snapshot().used[2], 10);
  } finally { await owner.close(); }
});

test("replacement preparation can explicitly omit the old cells", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(4096, 256));
  try {
    const store = BindingStore.create(owner);
    const first = await store.prepare("array", signal);
    try {
      first.binding.insert(9, await textToken(first.binding.owner, "old", signal));
      await first.publish();
    } finally { await first.close(); }
    const replacement = await store.prepare("array", signal, false);
    try {
      assert.equal(replacement.binding.maximum, -1);
      assert.equal(replacement.binding.values.size, 0);
      await replacement.publish();
    } finally { await replacement.close(); }
    assert.equal(store.get("array")!.values.size, 0);
    assert.equal(owner.ledger.snapshot().used[2], 5);
  } finally { await owner.close(); }
});

test("cancelled publication does not become visible and cleanup unblocks root closure", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(4096, 256));
  const store = BindingStore.create(owner);
  const controller = new AbortController();
  const prepared = await store.prepare("array", controller.signal);
  try {
    prepared.binding.insert(0, await textToken(prepared.binding.owner, "discard", signal));
    controller.abort(false);
    assert.throws(() => prepared.publish(), error => error === false);
    assert.equal(store.get("array"), undefined);
    const closing = owner.close();
    await prepared.close();
    await closing;
    assert.equal(store.watches.size, 0);
    assert.deepEqual(owner.ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
  } finally { await prepared.close(); await owner.close(); }
});

test("failed binding preparation restores live admissions on every bounded budget boundary", async () => {
  let rejected = 0;
  for (let fields = 4; fields <= 30; fields++) {
    const owner = ArrayOwner.create(new ArrayLedger(32, fields));
    try {
      const store = BindingStore.create(owner);
      const before = owner.ledger.snapshot().used.slice(0, 4);
      try {
        const prepared = await store.prepare("array", signal);
        await prepared.close();
      } catch (error) {
        assert.match(String(error), /limit exceeded/);
        rejected++;
      }
      assert.equal(store.bindings.size, 0);
      assert.equal(store.watches.size, 0);
      assert.deepEqual(owner.ledger.snapshot().used.slice(0, 4), before, `fields=${fields}`);
    } finally { await owner.close(); }
  }
  assert.ok(rejected > 0);
});

test("cancellation during the final cell checkpoint rejects without retaining new ownership", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(4096, 256));
  try {
    for (const value of ["text", shellValueFromBytes(Uint8Array.of(255))]) {
      const controller = new AbortController();
      const before = owner.ledger.snapshot().used.slice(0, 4);
      const pending = textToken(owner, value, controller.signal);
      controller.abort(0);
      await assert.rejects(pending, error => error === 0);
      assert.deepEqual(owner.ledger.snapshot().used.slice(0, 4), before);
    }
    const binding = IndexedBinding.create(owner);
    binding.insert(0, await textToken(binding.owner, "original", signal));
    const before = owner.ledger.snapshot().used.slice(0, 4);
    const controller = new AbortController();
    const pending = binding.copy(controller.signal);
    controller.abort(false);
    await assert.rejects(pending, error => error === false);
    assert.equal(binding.references, 1);
    assert.deepEqual(owner.ledger.snapshot().used.slice(0, 4), before);
  } finally { await owner.close(); }
});

test("raw cells cannot retain unlimited carriers through the metadata budget", async () => {
  const ledger = new ArrayLedger(4096, 4);
  const owner = ArrayOwner.create(ledger);
  try {
    const tokens = [];
    let exhausted = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try { tokens.push(await textToken(owner, shellValueFromBytes(new Uint8Array()), signal)); }
      catch (error) {
        assert.match(String(error), /metadata limit/);
        exhausted = true;
        break;
      }
    }
    assert.equal(exhausted, true);
    assert.equal(ledger.snapshot().used[2], 0);
    for (const token of tokens) token.release();
  } finally { await owner.close(); }
  assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
});

test("releasing a byte producer arena cannot invalidate an admitted indexed cell", async () => {
  const arena = new ValueArena(4096, 128, () => {});
  const scope = arena.scope();
  const owner = ArrayOwner.create(new ArrayLedger(4096, 128));
  try {
    const binding = IndexedBinding.create(owner);
    const value = shellValueFromBytes(Uint8Array.of(255, 254), scope);
    binding.insert(0, await textToken(binding.owner, value, signal));
    scope.close();
    arena.close();
    assert.deepEqual(shellValueBytes(binding.getValue(0)!), Uint8Array.of(255, 254));
    assert.equal(owner.ledger.snapshot().used[2], 2);
  } finally { scope.close(); arena.close(); await owner.close(); }
});

test("state readonly mutations invalidate prepared publication without weakening core guards", async () => {
  const scope = new InvocationScope();
  const raw: State = {
    cwd: "/", variables: Object.create(null) as Record<string, string>, exported: new Set(), readonlyVariables: new Set(),
    functions: new Map(), positional: [], status: 0, substitutionStatus: 0, depth: 0, loopDepth: 0, functionDepth: 0, locals: [], pipefail: false,
  };
  const state = trackState(raw, { limits: { maxExpansionBytes: 4096, maxExpansionFields: 256 } }, scope);
  try {
    const store = requireArrays(state);
    const prepared = await store.prepare("array", scope.signal);
    try {
      prepared.binding.insert(0, await textToken(prepared.binding.owner, shellValueFromBytes(Uint8Array.of(255)), scope.signal));
      state.readonlyVariables!.add("array");
      assert.throws(() => prepared.validate(), /changed/);
      assert.throws(() => prepared.publish(), /changed/);
      assert.equal(state.readonlyVariables!.has("array"), true);
      assert.equal(store.get("array"), undefined);
    } finally { await prepared.close(); }
    const accepted = await store.prepare("other", scope.signal);
    try {
      accepted.binding.insert(0, await textToken(accepted.binding.owner, "accepted", scope.signal));
      let retirement: Promise<void> | undefined;
      accepted.validate();
      stateMonitor(state)!.publish(accepted.tickets, "other", () => { retirement = accepted.publish(); });
      await retirement;
      assert.equal(store.get("other")!.get(0), "accepted");
      assert.equal(stateMonitor(state)!.epoch, accepted.tickets.epoch);
    } finally { await accepted.close(); }
  } finally { await scope.close(); }
  assert.deepEqual(scope.failures, []);
});

test("repeated byte preparations yield for cooperative cancellation and preserve the current binding", { timeout: 2000 }, async () => {
  const owner = ArrayOwner.create(new ArrayLedger(100_000, 10_000));
  const controller = new AbortController();
  const value = shellValueFromBytes(Uint8Array.of(255));
  const timer = setImmediate(() => controller.abort(false));
  let completed = 0;
  try {
    const binding = IndexedBinding.create(owner);
    await assert.rejects((async () => {
      for (let index = 0; index < 1000; index++) {
        binding.insert(0, await textToken(binding.owner, value, controller.signal));
        completed++;
      }
    })(), error => error === false);
    assert.ok(completed > 0 && completed < 1000);
    assert.equal(owner.ledger.snapshot().used[2], 1);
    assert.deepEqual(shellValueBytes(binding.getValue(0)!), Uint8Array.of(255));
  } finally { clearImmediate(timer); await owner.close(); }
});

test("different owner roots cannot share cells even when they use the same ledger", async () => {
  const ledger = new ArrayLedger(4096, 128);
  const owner = ArrayOwner.create(ledger);
  const other = ArrayOwner.create(ledger);
  try {
    const binding = IndexedBinding.create(owner);
    const token = await textToken(other, "unrelated", signal);
    assert.throws(() => binding.insert(0, token), /ownership/);
    assert.equal(binding.values.size, 0);
    assert.equal(token.admission.released, false);
  } finally { await owner.close(); await other.close(); }
  assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
});

test("retained local bindings restore raw cells through existing prepaid publication", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(4096, 256));
  try {
    const store = BindingStore.create(owner);
    const initial = await store.prepare("array", signal);
    try {
      initial.binding.insert(0, await textToken(initial.binding.owner, shellValueFromBytes(Uint8Array.of(255)), signal));
      await initial.publish();
    } finally { await initial.close(); }
    const saved = store.get("array")!.retain();
    const holding = owner.hold();
    const tickets = store.tickets("array");
    const replacement = await store.prepare("array", signal, false);
    try {
      replacement.binding.insert(0, await textToken(replacement.binding.owner, "local", signal));
      await replacement.publish();
    } finally { await replacement.close(); }
    const closing = owner.close();
    try {
      await store.publish("array", saved, tickets, undefined, true);
      assert.deepEqual(shellValueBytes(store.get("array")!.getValue(0)!), Uint8Array.of(255));
      assert.equal(saved.references, 1);
    } finally { tickets.release(); holding.release(); }
    await closing;
  } finally { await owner.close(); }
  assert.deepEqual(owner.ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
});

test("copy reference-cap refusal does not leak a clone admission", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(4096, 256));
  try {
    const binding = IndexedBinding.create(owner);
    const before = owner.ledger.snapshot().used.slice(0, 4);
    binding.references = Number.MAX_SAFE_INTEGER;
    try {
      await assert.rejects(binding.copy(signal), /reference capacity/);
      assert.deepEqual(owner.ledger.snapshot().used.slice(0, 4), before);
    } finally { binding.references = 1; }
  } finally { await owner.close(); }
});

test("preparation close drains displaced binding retirement before releasing its lifetime hold", async () => {
  const owner = ArrayOwner.create(new ArrayLedger(16_384, 2048));
  try {
    const store = BindingStore.create(owner);
    const initial = await store.prepare("array", signal);
    try {
      for (let index = 0; index < 100; index++) initial.binding.insert(index, await textToken(initial.binding.owner, "value", signal));
      await initial.publish();
    } finally { await initial.close(); }
    const previous = store.get("array")!;
    let retired = false;
    void previous.owner.completion.then(() => { retired = true; });
    const replacement = await store.prepare("array", signal, false);
    let retirement: Promise<void> | undefined;
    try {
      retirement = replacement.publish();
      await replacement.close();
      assert.equal(retired, true);
      assert.equal(previous.values.size, 0);
      assert.equal(owner.ledger.snapshot().used[2], 5);
    } finally { await retirement; await replacement.close(); }
  } finally { await owner.close(); }
});

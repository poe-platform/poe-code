import assert from "node:assert/strict";
import { test } from "node:test";
import { shellValueBytes, shellValueFromBytes, shellValueText } from "../../src/contracts/value.js";
import { ValueArena, ValueStore } from "../../src/shell/value-state.js";
import { arrayStore, snapshotState, stateMonitor, trackState } from "../../src/shell/arrays/state.js";
import { InvocationScope } from "../../src/shell/cleanup.js";
import type { State } from "../../src/shell/runtime.js";
import { Capture } from "../../src/shell/runtime.js";

function fixture(bytes = 4096, fields = 64) {
  const arena = new ValueArena(bytes, fields, () => {});
  const scope = arena.scope();
  const store = new ValueStore(arena);
  return { arena, scope, store };
}

test("retained scalar survives producer scope closure and releases on overwrite", () => {
  const { arena, scope, store } = fixture();
  const value = shellValueFromBytes(Uint8Array.of(255), scope);
  store.publish("value", value, () => true);
  scope.close();
  assert.deepEqual(shellValueBytes(store.get("value", "")), Uint8Array.of(255));
  store.invalidate("value");
  store.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("aliases share payload but reserve independent binding references", () => {
  const { arena, scope, store } = fixture();
  const value = shellValueFromBytes(Uint8Array.of(255), scope);
  store.publish("first", value, () => true);
  const first = arena.usage;
  store.publish("second", value, () => true);
  assert.equal(arena.usage.bytes - first.bytes, 32);
  assert.equal(arena.usage.slots - first.slots, 1);
  scope.close();
  store.invalidate("first");
  assert.deepEqual(shellValueBytes(store.get("second", "")), Uint8Array.of(255));
  store.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("failed publication releases staged ownership and preserves old binding", () => {
  const { arena, scope, store } = fixture();
  const original = shellValueFromBytes(Uint8Array.of(255), scope);
  const replacement = shellValueFromBytes(Uint8Array.of(254), scope);
  store.publish("value", original, () => true);
  const before = arena.usage;
  assert.equal(store.publish("value", replacement, () => false), false);
  assert.deepEqual(arena.usage, before);
  const reason = Object.freeze({ failed: true });
  assert.throws(() => store.publish("value", replacement, () => { throw reason; }), error => error === reason);
  assert.deepEqual(arena.usage, before);
  assert.equal(store.get("value", ""), original);
  arena.close();
});

test("clones retain bytes independently and mutations do not affect their parent", () => {
  const { arena, scope, store } = fixture();
  const value = shellValueFromBytes(Uint8Array.of(255), scope);
  store.publish("value", value, () => true);
  const copy = store.clone();
  store.invalidate("value");
  scope.close();
  assert.equal(copy.get("value", ""), value);
  copy.close();
  store.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("text-only values charge payload without byte-carrier overhead", () => {
  const { arena, scope, store } = fixture(6, 0);
  assert.equal(store.publish("text", "é🙂", () => true), true);
  assert.equal(store.get("text", "plain"), "é🙂");
  assert.deepEqual(arena.usage, { bytes: 6, slots: 0 });
  let writes = 0;
  assert.throws(() => store.publish("other", "a", () => { writes++; return true; }));
  assert.equal(writes, 0);
  scope.close();
  store.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("text aliases and cloned bindings conservatively charge each retained value", () => {
  const { arena, store } = fixture(32, 0);
  store.publish("first", "text", () => true);
  store.publish("second", "text", () => true);
  const clone = store.clone();
  assert.deepEqual(arena.usage, { bytes: 32, slots: 0 });
  store.invalidate("first");
  store.close();
  clone.invalidate("second");
  assert.equal(clone.get("first", ""), "text");
  assert.deepEqual(arena.usage, { bytes: 8, slots: 0 });
  clone.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("failed text publication and replacement retain prior ownership", () => {
  const { arena, store } = fixture(10, 0);
  store.publish("value", "old", () => true);
  const before = arena.usage;
  assert.equal(store.publish("value", "no", () => false), false);
  assert.deepEqual(arena.usage, before);
  assert.throws(() => store.publish("value", "no", () => { throw new Error("publication"); }), /publication/u);
  assert.throws(() => store.replace([["value", "no"]], () => { throw new Error("replacement"); }), /replacement/u);
  assert.deepEqual(arena.usage, before);
  assert.equal(store.get("value", ""), "old");
  store.publish("value", "no", () => true);
  assert.deepEqual(arena.usage, { bytes: 4, slots: 0 });
  store.invalidate("value");
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
  store.close();
});

test("string-only saved bindings and snapshots restore after cancellation without admission", () => {
  let cancelled = false;
  const arena = new ValueArena(24, 0, () => { if (cancelled) throw undefined; });
  const store = new ValueStore(arena);
  store.publish("value", "text", () => true);
  const saved = store.scope.hold("text");
  const snapshot = store.clone();
  store.invalidate("value");
  cancelled = true;
  store.restoreHeld("value", saved, () => {});
  store.restore(snapshot, () => {});
  snapshot.close();
  assert.equal(store.get("value", ""), "text");
  assert.deepEqual(arena.usage, { bytes: 8, slots: 0 });
  store.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("byte and reference limits fail before publication and clean reservations", () => {
  for (const [bytes, fields] of [[66, 64], [4096, 0]]) {
    const { arena, scope } = fixture(bytes, fields);
    assert.throws(() => shellValueFromBytes(Uint8Array.of(255), scope));
    scope.close();
    assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
  }
  const { arena, store } = fixture(4096, 1);
  let writes = 0;
  assert.throws(() => store.publish("value", shellValueFromBytes(Uint8Array.of(255)), () => { writes++; return true; }));
  assert.equal(writes, 0);
  store.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("closed scopes deny allocation while release remains idempotent", () => {
  const { arena, scope } = fixture();
  const reservation = scope.reserve(1, 1);
  scope.close();
  reservation.release();
  assert.throws(() => scope.reserve(1, 1), /closed/u);
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("a byte projection never authorizes equal replacement text", () => {
  const { arena, scope, store } = fixture();
  const raw = shellValueFromBytes(Uint8Array.of(255), scope);
  store.publish("value", raw, () => true);
  store.invalidate("value");
  assert.deepEqual(shellValueBytes(store.get("value", shellValueText(raw))), Uint8Array.of(239, 191, 189));
  arena.close();
});

function tracked() {
  const raw = { variables: { value: "\ufffd" }, positional: [], locals: [] } as unknown as State;
  const scope = new InvocationScope();
  const state = trackState(raw, { limits: { maxExpansionBytes: 4096, maxExpansionFields: 64 } }, scope);
  const monitor = stateMonitor(state)!;
  monitor.values.publish("value", shellValueFromBytes(Uint8Array.of(255)), () => true);
  return { raw, scope, state, monitor };
}

for (const mutation of ["set", "delete", "define", "replace"] as const) {
  test(`scalar ownership invalidates on successful ${mutation} without array activation`, async () => {
    const { state, scope, monitor } = tracked();
    assert.equal(arrayStore(state), undefined);
    if (mutation === "set") state.variables.value = "\ufffd";
    if (mutation === "delete") delete state.variables.value;
    if (mutation === "define") Object.defineProperty(state.variables, "value", { value: "\ufffd", configurable: true, writable: true });
    if (mutation === "replace") state.variables = { value: "\ufffd" };
    assert.equal(typeof monitor.values.get("value", state.variables.value ?? ""), "string");
    assert.equal(arrayStore(state), undefined);
    await scope.close();
  });
}

test("publication suppression never suppresses byte invalidation", async () => {
  const { state, scope, monitor } = tracked();
  monitor.publish({ generation: 0, version: 0, epoch: 0 }, "value", () => { state.variables.value = "\ufffd"; });
  assert.equal(typeof monitor.values.get("value", "\ufffd"), "string");
  await scope.close();
});

test("failed proxy mutations preserve byte ownership", async () => {
  const { raw, state, scope, monitor } = tracked();
  Object.defineProperty(raw.variables, "value", { value: "\ufffd", configurable: false, writable: false });
  assert.equal(Reflect.set(state.variables, "value", "other"), false);
  assert.equal(Reflect.deleteProperty(state.variables, "value"), false);
  assert.equal(Reflect.defineProperty(state.variables, "value", { value: "other" }), false);
  assert.deepEqual(shellValueBytes(monitor.values.get("value", "")), Uint8Array.of(255));
  await scope.close();
});

test("detached variables cannot invalidate the replacement collection", async () => {
  const { state, scope, monitor } = tracked();
  const previous = state.variables;
  state.variables = { value: "\ufffd" };
  monitor.values.publish("value", shellValueFromBytes(Uint8Array.of(254)), () => true);
  previous.value = "detached";
  assert.deepEqual(shellValueBytes(monitor.values.get("value", "")), Uint8Array.of(254));
  await scope.close();
});

test("no-array snapshot retains byte bindings and independent mutation tracking", async () => {
  const { state, scope, monitor } = tracked();
  const copy = await snapshotState(state, () => ({ ...state, variables: { ...state.variables } }), new AbortController().signal);
  state.variables.value = "new";
  assert.equal(arrayStore(copy), undefined);
  assert.deepEqual(shellValueBytes(stateMonitor(copy)!.values.get("value", "")), Uint8Array.of(255));
  assert.equal(typeof monitor.values.get("value", "new"), "string");
  await scope.close();
});

test("independently charged copies survive closure of a different arena", () => {
  const first = fixture();
  const value = shellValueFromBytes(Uint8Array.of(255), first.scope);
  const second = fixture();
  second.store.publish("value", value, () => true);
  first.arena.close();
  assert.deepEqual(shellValueBytes(second.store.get("value", "")), Uint8Array.of(255));
  assert.ok(second.arena.usage.bytes > 0);
  second.store.close();
  second.scope.close();
  assert.deepEqual(second.arena.usage, { bytes: 0, slots: 0 });
});

test("failed multi-binding replacement leaves the prior positional ownership intact", () => {
  const { arena, scope, store } = fixture();
  const original = shellValueFromBytes(Uint8Array.of(255), scope);
  store.publish("0", original, () => true);
  const before = arena.usage;
  const reason = Object.freeze({ failed: true });
  assert.throws(() => store.replace([["0", original]], () => { throw reason; }), error => error === reason);
  assert.deepEqual(arena.usage, before);
  assert.equal(store.get("0", ""), original);
  arena.close();
});

test("adoption commit failure releases both payload and reference", () => {
  let checks = 0;
  const reason = Object.freeze({ cancelled: true });
  const arena = new ValueArena(4096, 64, () => { if (++checks === 4) throw reason; });
  assert.throws(() => arena.hold(shellValueFromBytes(Uint8Array.of(255))), error => error === reason);
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("capture coalesces tiny writes without retaining one fragment per write", async () => {
  const capture = new Capture();
  for (let index = 0; index < 5000; index++) await capture.write(Uint8Array.of(index % 256));
  for (let index = 0; index < 100; index++) await capture.write(new Uint8Array());
  assert.equal(capture.length, 5000);
  assert.ok(capture.chunks.length <= 2);
  assert.deepEqual(capture.bytes(), Uint8Array.from({ length: 5000 }, (_, index) => index % 256));
});

test("capture bytes retains independent live snapshots", async () => {
  const capture = new Capture();
  const producer = Uint8Array.of(65, 66);
  await capture.write(producer);
  producer.fill(90);
  const first = capture.bytes();
  const second = capture.bytes();
  first[0] = 88;
  await capture.write(Uint8Array.of(67));
  assert.deepEqual(second, Uint8Array.of(65, 66));
  assert.deepEqual(capture.bytes(), Uint8Array.of(65, 66, 67));
});

for (const length of [0, 17, 4096, 4113, 8192]) {
  test(`capture terminal extraction owns ${length} bytes and releases storage`, async context => {
    const capture = new Capture();
    for (let offset = 0; offset < length; offset += 4096) {
      const producer = new Uint8Array(Math.min(4096, length - offset)).fill(65);
      await capture.write(producer);
      producer.fill(90);
    }
    const previousChunks = [...capture.chunks];
    const snapshot = capture.bytes();
    const set = context.mock.method(Uint8Array.prototype, "set");
    const extracted = capture.takeBytes();
    const copiedBytes = set.mock.calls.reduce((total, call) => total + (call.this === extracted ? call.arguments[0].length : 0), 0);
    set.mock.restore();
    assert.equal(copiedBytes, length === 4096 ? 0 : length);
    assert.equal(extracted.byteLength, length);
    assert.equal(extracted.buffer.byteLength, length);
    assert.ok(extracted.every(byte => byte === 65));
    assert.equal(previousChunks.some(chunk => chunk.buffer === extracted.buffer), length === 4096);
    assert.equal(capture.length, 0);
    assert.deepEqual(capture.chunks, []);
    assert.deepEqual(capture.bytes(), new Uint8Array());
    assert.deepEqual(capture.takeBytes(), new Uint8Array());
    await capture.write(Uint8Array.of(66));
    assert.ok(previousChunks.every(chunk => chunk.buffer !== capture.chunks[0]!.buffer));
    assert.equal(extracted.byteLength, length);
    assert.ok(extracted.every(byte => byte === 65));
    extracted.fill(88);
    assert.deepEqual(capture.bytes(), Uint8Array.of(66));
    assert.equal(snapshot.byteLength, length);
    assert.ok(snapshot.every(byte => byte === 65));
  });
}

test("prepared restoration transfers ownership without new admission after cancellation", () => {
  let cancelled = false;
  const reason = Object.freeze({ cancelled: true });
  const arena = new ValueArena(4096, 64, () => { if (cancelled) throw reason; });
  const store = new ValueStore(arena);
  store.publish("value", shellValueFromBytes(Uint8Array.of(255)), () => true);
  const snapshot = store.clone();
  store.invalidate("value");
  cancelled = true;
  let restored = false;
  store.restore(snapshot, () => { restored = true; });
  snapshot.close();
  assert.equal(restored, true);
  assert.deepEqual(shellValueBytes(store.get("value", "")), Uint8Array.of(255));
  store.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("failed prepared restoration preserves source, destination and falsey failure", () => {
  const { arena, store } = fixture();
  const original = shellValueFromBytes(Uint8Array.of(255));
  store.publish("value", original, () => true);
  const snapshot = store.clone();
  const replacement = shellValueFromBytes(Uint8Array.of(254));
  store.publish("value", replacement, () => true);
  const before = arena.usage;
  for (const reason of [undefined, null, false, 0, ""]) {
    let failed = false;
    try { store.restore(snapshot, () => { throw reason; }); }
    catch (error) { failed = true; assert.equal(error, reason); }
    assert.equal(failed, true);
    assert.equal(store.get("value", ""), replacement);
    assert.equal(snapshot.get("value", ""), original);
    assert.deepEqual(arena.usage, before);
  }
  store.close();
  snapshot.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

for (const finalText of ["\ufffd", ""]) {
  test(`duplicate replacement removes staged raw ownership for final text ${JSON.stringify(finalText)}`, () => {
    const { arena, store } = fixture();
    const raw = shellValueFromBytes(Uint8Array.of(255));
    const before = arena.usage;
    let published = "initial";
    store.replace([["value", raw], ["value", finalText]], () => { published = finalText; });
    assert.deepEqual(shellValueBytes(store.get("value", published)), new TextEncoder().encode(finalText));
    assert.equal(arena.usage.bytes - before.bytes, 64 + finalText.length * 2);
    assert.equal(arena.usage.slots - before.slots, 1);
    store.close();
    assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
  });
}

test("duplicate raw-to-text staging still rolls back on falsey publication failure", () => {
  const { arena, store } = fixture();
  const original = shellValueFromBytes(Uint8Array.of(254));
  store.publish("value", original, () => true);
  const before = arena.usage;
  let failed = false;
  try { store.replace([["value", shellValueFromBytes(Uint8Array.of(255))], ["value", ""]], () => { throw false; }); }
  catch (reason) { failed = true; assert.equal(reason, false); }
  assert.equal(failed, true);
  assert.equal(store.get("value", ""), original);
  assert.deepEqual(arena.usage, before);
  store.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("same-scope saved scalar restores without fresh quota or cancellation checks", () => {
  let cancelled = false;
  const arena = new ValueArena(256, 8, () => { if (cancelled) throw undefined; });
  const store = new ValueStore(arena);
  const original = shellValueFromBytes(Uint8Array.of(255));
  store.publish("value", original, () => true);
  const saved = store.scope.hold(original);
  store.invalidate("value");
  cancelled = true;
  const before = arena.usage;
  store.restoreHeld("value", saved, () => {});
  assert.equal(store.get("value", ""), original);
  assert.deepEqual(arena.usage, before);
  store.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("repeated prepared snapshot transfers do not grow ownership or retain closed sources", () => {
  const { arena, store } = fixture();
  store.publish("value", shellValueFromBytes(Uint8Array.of(255)), () => true);
  const initial = arena.usage;
  for (let iteration = 0; iteration < 100; iteration++) {
    const snapshot = store.clone();
    store.restore(snapshot, () => {});
    snapshot.close();
    assert.deepEqual(arena.usage, initial);
    assert.deepEqual(shellValueBytes(store.get("value", "")), Uint8Array.of(255));
  }
  store.close();
  assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
});

test("cross-arena or closed restoration is rejected before mutation", () => {
  const first = fixture();
  const second = fixture();
  first.store.publish("value", shellValueFromBytes(Uint8Array.of(255)), () => true);
  second.store.publish("value", shellValueFromBytes(Uint8Array.of(254)), () => true);
  let mutations = 0;
  assert.throws(() => second.store.restore(first.store, () => { mutations++; }), /not prepared/u);
  const snapshot = first.store.clone();
  first.store.close();
  assert.throws(() => first.store.restore(snapshot, () => { mutations++; }), /not prepared/u);
  assert.equal(mutations, 0);
  snapshot.close();
  second.store.close();
  assert.deepEqual(first.arena.usage, { bytes: 0, slots: 0 });
  assert.deepEqual(second.arena.usage, { bytes: 0, slots: 0 });
});

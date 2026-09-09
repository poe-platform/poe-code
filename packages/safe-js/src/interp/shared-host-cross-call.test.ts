import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { Budget } from "./budget.js";
import { createSharedArrayBufferStorage } from "./shared-array-buffer.js";
import { HostCallJournal } from "./host-call.js";

it("retains exposed storage roots until journal disposal", () => {
  const budget = new Budget();
  const journal = new HostCallJournal("shared-roots", [], undefined, undefined, budget);
  const buffer = createSharedArrayBufferStorage(4, undefined, budget);
  const { record } = journal.issue({ moduleId: "host", operation: "save", argumentDigest: "buffer", policy: "re-issue" });
  journal.registerSharedArguments(record, [buffer]);
  journal.settle(record, { status: "fulfilled", value: undefined });
  expect([...budget.retainedValues()]).toContain(buffer);
  journal.dispose();
  expect([...budget.retainedValues()]).not.toContain(buffer);
});

it("rejects malformed shared registry markers", () => {
  const journal = new HostCallJournal("shared-marker");
  const { record } = journal.issue({ moduleId: "host", operation: "save", argumentDigest: "buffer", policy: "re-issue" });
  journal.settle(record, { status: "fulfilled", value: undefined });
  const replay = journal.snapshotReplay();
  Object.defineProperty(replay.calls[0], "sharedRegistry", { value: "yes", enumerable: true });
  expect(() => new HostCallJournal("shared-marker", [], undefined, replay)).toThrow(TypeError);
});

it.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER])("rejects malformed shared event order %s", order => {
  const journal = new HostCallJournal("shared-order");
  const { record } = journal.issue({ moduleId: "host", operation: "save", argumentDigest: "buffer", policy: "re-issue" });
  journal.registerSharedArguments(record, [createSharedArrayBufferStorage(4, undefined, new Budget())]);
  journal.settle(record, { status: "fulfilled", value: undefined });
  const replay = journal.snapshotReplay();
  Object.defineProperty(replay.calls[0], "sharedEffectOrder", { value: order, enumerable: true });
  expect(() => new HostCallJournal("shared-order", [], undefined, replay)).toThrow(TypeError);
});

it("rejects duplicate shared event orders across calls", () => {
  const journal = new HostCallJournal("shared-order");
  const buffer = createSharedArrayBufferStorage(4, undefined, new Budget());
  for (let index = 0; index < 2; index++) {
    const { record } = journal.issue({ moduleId: "host", operation: "save", argumentDigest: "buffer", policy: "re-issue" });
    journal.registerSharedArguments(record, [buffer]);
    journal.settle(record, { status: "fulfilled", value: undefined });
  }
  const replay = journal.snapshotReplay();
  replay.calls[1].sharedEffectOrder = replay.calls[0].sharedEffectOrder;
  expect(() => new HostCallJournal("shared-order", [], undefined, replay)).toThrow(TypeError);
});

it.each([false, true])("replays retained host argument aliases across calls (async=%s)", async (asynchronous) => {
  let retained!: SharedArrayBuffer;
  let calls = 0;
  const effect = () => {
    calls++;
    new Uint8Array(retained)[0] = 9;
    return 17;
  };
  const bindings = {
    save: (buffer: SharedArrayBuffer) => { calls++; retained = buffer; return buffer; },
    mutate: asynchronous ? async () => { await Promise.resolve(); return effect(); } : effect
  };
  const source = `const b=new SharedArrayBuffer(4);const c=save(b);
    const n=await mutate();return [new Uint8Array(b)[0],new Uint8Array(c)[0],n,b===c]`;
  const result = await run(source, { bindings });
  expect(result).toMatchObject({ ok: true, returnValue: [9, 9, 17, false] });
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(result)) }))
    .toMatchObject({ ok: true, returnValue: [9, 9, 17, false] });
  expect(calls).toBe(2);
});

it("replays later growth of storage first returned by the host", async () => {
  let retained!: SharedArrayBuffer;
  let calls = 0;
  const bindings = {
    make: () => { calls++; retained = createSharedArrayBufferStorage(4, 8, new Budget()); return retained; },
    mutate: () => { calls++; retained.grow(8); new Uint8Array(retained)[7] = 9; return 17; }
  };
  const source = `const b=make();const a=new Uint8Array(b);const n=mutate();
    return [b.byteLength,a[7],n]`;
  const result = await run(source, { bindings });
  expect(result).toMatchObject({ ok: true, returnValue: [8, 9, 17] });
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(result)) }))
    .toMatchObject({ ok: true, returnValue: [8, 9, 17] });
  expect(calls).toBe(2);
});

it.each([false, true])("keeps independently retained blocks separate when a later call rejects (async=%s)", async asynchronous => {
  const retained: SharedArrayBuffer[] = [];
  let calls = 0;
  const effect = () => {
    calls++;
    new Uint8Array(retained[0])[0] = 7;
    new Uint8Array(retained[1])[0] = 9;
    throw new Error("mutated");
  };
  const bindings = {
    save: (buffer: SharedArrayBuffer) => { calls++; retained.push(buffer); },
    mutate: asynchronous ? async () => { await Promise.resolve(); return effect(); } : effect
  };
  const source = `const a=new Uint8Array(new SharedArrayBuffer(4));
    const b=new Uint8Array(new SharedArrayBuffer(4));save(a.buffer);save(b.buffer);
    let error;try{await mutate()}catch(e){error=e.message}return [a[0],b[0],error]`;
  const result = await run(source, { bindings });
  expect(result).toMatchObject({ ok: true, returnValue: [7, 9, "mutated"] });
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(result)) }))
    .toMatchObject({ ok: true, returnValue: [7, 9, "mutated"] });
  expect(calls).toBe(3);
});

it.each([false, true])("preserves a shared block returned repeatedly by the host (async=%s)", async asynchronous => {
  const buffer = createSharedArrayBufferStorage(4, undefined, new Budget());
  let calls = 0;
  const expose = () => { calls++; return { buffer }; };
  const bindings = { expose: asynchronous ? async () => expose() : expose };
  const source = `const first=(await expose()).buffer;const second=(await expose()).buffer;
    new Uint8Array(first)[0]=7;return [first===second,new Uint8Array(second)[0]]`;
  const result = await run(source, { bindings });
  expect(result).toMatchObject({ ok: true, returnValue: [false, 7] });
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(result)) }))
    .toMatchObject({ ok: true, returnValue: [false, 7] });
  expect(calls).toBe(2);
});

it("restores shared writes before a callback invoked after a host await", async () => {
  let calls = 0;
  const bindings = { perform: async (buffer: SharedArrayBuffer, callback: () => Promise<unknown>) => {
    calls++;
    await new Promise<void>(resolve => setImmediate(resolve));
    new Uint8Array(buffer)[0] = 2;
    await callback();
    new Uint8Array(buffer)[0] = 3;
  } };
  const source = `const b=new SharedArrayBuffer(4);const a=new Uint8Array(b);let seen;
    await perform(b,()=>{seen=a[0];a[0]++});return [seen,a[0]]`;
  const result = await run(source, { bindings });
  expect(result).toMatchObject({ ok: true, returnValue: [2, 3] });
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(result)) }))
    .toMatchObject({ ok: true, returnValue: [2, 3] });
  expect(calls).toBe(1);
});

it("reconnects callback argument and receiver storage to the guest block", async () => {
  let calls = 0;
  const bindings = { perform: async (buffer: SharedArrayBuffer, callback: (this: { buffer: SharedArrayBuffer }, buffer: SharedArrayBuffer) => Promise<unknown>) => {
    calls++;
    await new Promise<void>(resolve => setImmediate(resolve));
    new Uint8Array(buffer)[0] = 2;
    await callback.call({ buffer }, buffer);
  } };
  const source = `const b=new SharedArrayBuffer(4);const a=new Uint8Array(b);let seen;
    await perform(b,function(other){seen=[a[0],new Uint8Array(other)[0],new Uint8Array(this.buffer)[0]];
      new Uint8Array(other)[0]=7;});return [seen,a[0]]`;
  const result = await run(source, { bindings });
  expect(result).toMatchObject({ ok: true, returnValue: [[2, 2, 2], 7] });
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(result)) }))
    .toMatchObject({ ok: true, returnValue: [[2, 2, 2], 7] });
  expect(calls).toBe(1);
});

it("replays shared writes observed while their originating host call remains pending", async () => {
  let openFirst!: () => void;
  let openLast!: () => void;
  let signalWritten!: () => void;
  const firstGate = new Promise<void>(resolve => { openFirst = resolve; });
  const lastGate = new Promise<void>(resolve => { openLast = resolve; });
  const written = new Promise<void>(resolve => { signalWritten = resolve; });
  let calls = 0;
  const bindings = {
    mutate: async (buffer: SharedArrayBuffer) => {
      calls++;
      await firstGate;
      new Uint8Array(buffer)[0] = 1;
      signalWritten();
      await lastGate;
      new Uint8Array(buffer)[0] = 2;
    },
    checkpoint: async () => { calls++; openFirst(); await written; return 0; },
    finish: () => { calls++; openLast(); }
  };
  const source = `const b=new SharedArrayBuffer(4);const a=new Uint8Array(b);
    const pending=mutate(b);await checkpoint();const middle=a[0];
    finish();await pending;return [middle,a[0]]`;
  try {
    const result = await run(source, { bindings });
    expect(result).toMatchObject({ ok: true, returnValue: [1, 2] });
    expect(await run(source, { bindings, snapshot: JSON.parse(await dump(result)) }))
      .toMatchObject({ ok: true, returnValue: [1, 2] });
    expect(calls).toBe(3);
  } finally {
    openFirst();
    openLast();
    signalWritten();
  }
});

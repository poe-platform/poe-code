import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { declareHostOperation } from "./host-bridge.js";
import legacy from "./legacy-graph-v8.fixture.json" with { type: "json" };

const shapes: Array<[string, string, (value: any) => SharedArrayBuffer]> = [
  ["direct", "b", value => value],
  ["Map value", "new Map([['b', b]])", value => value.get("b")],
  ["Map key", "new Map([[b, 1]])", value => value.keys().next().value],
  ["Set", "new Set([b])", value => value.values().next().value],
  ["object symbol", "({[Symbol('b')]: b})", value => value[Object.getOwnPropertySymbols(value)[0]]],
  ["array symbol", "Object.assign([], {[Symbol('b')]: b})", value => value[Object.getOwnPropertySymbols(value)[0]]],
  ["array property", "Object.assign([], {b})", value => value.b],
  ["nested view", "({m: new Map([['b', new Uint8Array(b)]])})", value => value.m.get("b").buffer],
  ["cyclic Map", "(()=>{const m=new Map([['b', b]]);m.set('self',m);return m})()", value => {
    expect(value.get("self")).toBe(value);
    return value.get("b");
  }],
  ["mixed aliases", "[b, new Map([['b', b]])]", value => {
    expect(value[0]).toBe(value[1].get("b"));
    return value[0];
  }]
];

it.each([false, true])("rejects unsupported custom descriptors before export (async=%s)", async asynchronous => {
  let calls = 0;
  await expect(run("save(Object.defineProperty({},'b',{value:new SharedArrayBuffer(4)}))", {
    bindings: { save: asynchronous ? async () => { calls++; } : () => { calls++; } }
  })).rejects.toThrow("Guest prototype links and custom descriptors cannot be copied as data");
  expect(calls).toBe(0);
});

it.each(shapes)("recovers synchronous shared argument storage: %s", async (_name, expression, extract) => {
  let calls = 0;
  const source = `const b=new SharedArrayBuffer(4);save(${expression});return new Uint8Array(b)[0]`;
  const bindings = { save(value: unknown) { calls++; new Uint8Array(extract(value))[0] = 7; } };
  const original = await run(source, { bindings });
  expect(original).toMatchObject({ ok: true, returnValue: 7 });
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(original)) }))
    .toMatchObject({ ok: true, returnValue: 7 });
  expect(calls).toBe(1);
});

it("rejects a genuine legacy omitted-edge record before host effects", async () => {
  let effects = 0;
  await expect(run(legacy.source, { snapshot: legacy.snapshot, bindings: {
    save() { effects++; }, effect() { effects++; }
  } })).rejects.toThrow("Shared argument graph has no recorded recovery coverage");
  expect(effects).toBe(0);
});

it("accepts legacy graph edges already covered by the shared registry", async () => {
  const source = `const b=new SharedArrayBuffer(4);save(b);save(new Map([[1,b]]));return new Uint8Array(b)[0]`;
  let calls = 0;
  const bindings = { save(value: SharedArrayBuffer | Map<number, SharedArrayBuffer>) {
    calls++;
    new Uint8Array(value instanceof Map ? value.get(1)! : value)[0]++;
  } };
  const original = await run(source, { bindings });
  expect(original).toMatchObject({ ok: true, returnValue: 2 });
  const snapshot = JSON.parse(await dump(original));
  delete snapshot.replay.calls[1].sharedGraph;
  expect(await run(source, { bindings, snapshot })).toMatchObject({ ok: true, returnValue: 2 });
  expect(calls).toBe(2);
});

it.each([false, "true", 1])("rejects malformed shared graph marker %s before effects", async marker => {
  const source = "save(new Map([[1,new SharedArrayBuffer(4)]]));return 7";
  const original = await run(source, { bindings: { save() {} } });
  const snapshot = JSON.parse(await dump(original));
  snapshot.replay.calls[0].sharedGraph = marker;
  let effects = 0;
  await expect(run(source, { snapshot, bindings: { save() { effects++; } } }))
    .rejects.toThrow("Invalid shared argument graph marker");
  expect(effects).toBe(0);
});

it("records newly reached graph exports after pending recovery", async () => {
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const source = "await hold();const b=new SharedArrayBuffer(4);save(new Map([[1,b]]));return new Uint8Array(b)[0]";
  const save = (value: Map<number, SharedArrayBuffer>) => { new Uint8Array(value.get(1)!)[0] = 7; };
  const pending = run(source, { bindings: { save, hold: declareHostOperation(async () => {
    entered(); await gate;
  }, "re-issue") } });
  let snapshot;
  try { await Promise.race([ready, pending.then(() => { throw new Error("Host operation did not suspend"); })]); snapshot = JSON.parse(await dump(pending, { mode: "replay" })); }
  finally { release(); }
  expect(await pending).toMatchObject({ ok: true, returnValue: 7 });
  const bindings = { save, hold: declareHostOperation(async () => {}, "re-issue") };
  const resumed = await run(source, { bindings, snapshot });
  expect(resumed).toMatchObject({ ok: true, returnValue: 7 });
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(resumed)) }))
    .toMatchObject({ ok: true, returnValue: 7 });
});

it("preserves digest block order when export order differs", async () => {
  const source = `const a=new SharedArrayBuffer(4),b=new SharedArrayBuffer(4);
    save([new Map([[1,a]]),b]);return [new Uint8Array(a)[0],new Uint8Array(b)[0]]`;
  let calls = 0;
  const bindings = { save(value: [Map<number, SharedArrayBuffer>, SharedArrayBuffer]) {
    calls++;
    new Uint8Array(value[0].get(1)!)[0] = 7;
    new Uint8Array(value[1])[0] = 9;
  } };
  const original = await run(source, { bindings });
  expect(original).toMatchObject({ ok: true, returnValue: [7, 9] });
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(original)) }))
    .toMatchObject({ ok: true, returnValue: [7, 9] });
  expect(calls).toBe(1);
});

it("reconciles a pending graph export without reissuing its side effect", async () => {
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const source = `const b=new SharedArrayBuffer(4),a=new Uint8Array(b);
    const pending=save(new Map([[1,b]]));const before=a[0];await pending;return [before,a[0]]`;
  const pending = run(source, { bindings: { save: declareHostOperation(async (value: Map<number, SharedArrayBuffer>) => {
    new Uint8Array(value.get(1)!)[0]++;
    entered(); await gate; return 17;
  }, "read-side-effect") } });
  let snapshot;
  try { await Promise.race([ready, pending.then(() => { throw new Error("Host operation did not suspend"); })]); snapshot = JSON.parse(await dump(pending, { mode: "replay" })); }
  finally { release(); }
  expect(await pending).toMatchObject({ ok: true, returnValue: [1, 1] });
  let calls = 0;
  expect(await run(source, { snapshot, bindings: { save: declareHostOperation(async () => {
    calls++; throw new Error("Side effect must be reconciled");
  }, "read-side-effect") }, hostCallResumeProvider: request => ({
    ...request, outcome: { status: "fulfilled", value: 17 }
  }) })).toMatchObject({ ok: true, returnValue: [1, 1] });
  expect(calls).toBe(0);
});

it.each(shapes)("recovers pending shared argument storage: %s", async (_name, expression, extract) => {
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const source = `const b=new SharedArrayBuffer(4);await save(${expression});return new Uint8Array(b)[0]`;
  const pending = run(source, { bindings: { save: declareHostOperation(async (value: unknown) => {
    new Uint8Array(extract(value))[0] = 7;
    entered();
    await gate;
  }, "re-issue") } });
  let snapshot;
  try {
    await Promise.race([ready, pending.then(() => { throw new Error("Host operation did not suspend"); })]);
    snapshot = JSON.parse(await dump(pending, { mode: "replay" }));
  } finally { release(); }
  const original = await pending;
  expect(original).toMatchObject({ ok: true, returnValue: 7 });
  let resumed = 0;
  const bindings = { save: declareHostOperation(async (value: unknown) => {
    resumed++;
    expect(new Uint8Array(extract(value))[0]).toBe(0);
    new Uint8Array(extract(value))[0] = 7;
  }, "re-issue") };
  expect(await run(source, { bindings, snapshot })).toMatchObject({ ok: true, returnValue: 7 });
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(original)) }))
    .toMatchObject({ ok: true, returnValue: 7 });
  expect(resumed).toBe(1);
});

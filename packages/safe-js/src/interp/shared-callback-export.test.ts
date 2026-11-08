import { expect, it } from "vitest";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { declareHostOperation } from "./host-bridge.js";

it("rejects recovery of storage exported only by a guest callback", async () => {
  let calls = 0;
  const source = `const b=new SharedArrayBuffer(4);const a=new Uint8Array(b);
    await receive(()=>b);return a[0]`;
  const bindings = {
    receive: async (callback: () => Promise<SharedArrayBuffer>) => {
      calls++;
      const buffer = await callback();
      new Uint8Array(buffer)[0] = 7;
    }
  };
  const original = await run(source, { bindings });
  expect(original).toMatchObject({ ok: true, returnValue: 7 });
  expect(original.snapshot.replayError).toContain("Shared storage exported by a guest callback");
  await expect(dump(original)).rejects.toThrow("Shared storage exported by a guest callback");
  await expect(run(source, { bindings, snapshot: original.snapshot })).rejects
    .toThrow("Shared storage exported by a guest callback");
  expect(calls).toBe(1);
});

it.each(["b", "new Uint8Array(b)", "new DataView(b)", "{nested:[b,b]}"])(
  "marks shared callback exports nested in %s", async expression => {
    const result = await run(`const b=new SharedArrayBuffer(8);
      await receive(async()=>${expression.startsWith("{") ? `(${expression})` : expression});return 17`, {
      bindings: { receive: async (callback: () => Promise<unknown>) => { await callback(); } }
    });
    expect(result).toMatchObject({ ok: true, returnValue: 17 });
    expect(result.snapshot.replayError).toContain("Shared storage exported by a guest callback");
  }
);

it.each([false, true])("marks thrown shared callback storage (async=%s)", async asynchronous => {
  const result = await run(`const b=new SharedArrayBuffer(4);
    await receive(${asynchronous ? "async " : ""}()=>{throw {buffer:b}});return 17`, {
    bindings: { receive: async (callback: () => Promise<unknown>) => {
      await expect(callback()).rejects.toHaveProperty("buffer");
    } }
  });
  expect(result).toMatchObject({ ok: true, returnValue: 17 });
  expect(result.snapshot.replayError).toContain("Shared storage exported by a guest callback");
});

it("rejects pending capture after the host acknowledges receiving shared storage", async () => {
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const source = `const b=new SharedArrayBuffer(4);await receive(()=>b);return 17`;
  const pending = run(source, { bindings: {
    receive: declareHostOperation(async (callback: () => Promise<SharedArrayBuffer>) => {
      await callback();
      entered();
      await gate;
    }, "read-side-effect")
  } });
  try {
    await ready;
    await expect(dump(pending, { mode: "replay" })).rejects
      .toThrow("Shared storage exported by a guest callback");
  } finally {
    release();
    expect(await pending).toMatchObject({ ok: true, returnValue: 17 });
  }
});

it("keeps confined shared memory recoverable when callbacks export ordinary data", async () => {
  let calls = 0;
  const source = `const b=new SharedArrayBuffer(4);const a=new Int32Array(b);
    Atomics.store(a,0,7);await receive(()=>new Uint8Array([1,2]));return Atomics.load(a,0)`;
  const bindings = { receive: async (callback: () => Promise<unknown>) => { calls++; await callback(); } };
  const original = await run(source, { bindings });
  expect(original).toMatchObject({ ok: true, returnValue: 7 });
  expect(original.snapshot.replayError).toBeUndefined();
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(original)) }))
    .toMatchObject({ ok: true, returnValue: 7 });
  expect(calls).toBe(1);
});

it("rejects callback-export recovery after an independently scheduled worker write", async () => {
  const worker = new Worker(`
    const {parentPort}=require('node:worker_threads');
    parentPort.once('message',buffer=>{
      const view=new Int32Array(buffer);
      Atomics.store(view,1,1);
      parentPort.postMessage('ready');
      Atomics.wait(view,1,1);
      Atomics.store(view,0,7);
      parentPort.postMessage('written');
    });`, { eval: true, execArgv: [] });
  let hostProgressed = false;
  let calls = 0;
  const source = `const b=new SharedArrayBuffer(8);await receive(()=>b);
    return Atomics.load(new Int32Array(b),0)`;
  const bindings = { receive: async (callback: () => Promise<SharedArrayBuffer>) => {
    calls++;
    const buffer = await callback();
    const ready = once(worker, "message");
    worker.postMessage(buffer);
    expect((await ready)[0]).toBe("ready");
    await new Promise<void>(resolve => setImmediate(resolve));
    hostProgressed = true;
    const written = once(worker, "message");
    const view = new Int32Array(buffer);
    Atomics.store(view, 1, 2);
    Atomics.notify(view, 1);
    expect((await written)[0]).toBe("written");
  } };
  try {
    const original = await run(source, { bindings });
    expect(original).toMatchObject({ ok: true, returnValue: 7 });
    expect(hostProgressed).toBe(true);
    await expect(run(source, { bindings, snapshot: original.snapshot })).rejects
      .toThrow("Shared storage exported by a guest callback");
    expect(calls).toBe(1);
  } finally {
    await worker.terminate();
  }
});

import { expect, it } from "vitest";
import { run } from "../../run.js";

const nativeWait = Reflect.get(Atomics, "waitAsync") as (...args: unknown[]) => { async: boolean; value: string | Promise<string> };

it("removes an infinite atomic waiter when its sandbox run is aborted", async () => {
  const controller = new AbortController();
  let buffer: SharedArrayBuffer | undefined;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const pending = run(`const b=new SharedArrayBuffer(4);
    const waiter=Atomics.waitAsync(new Int32Array(b),0,0);
    entered(b);return await waiter.value`, {
    signal: controller.signal,
    bindings: { entered: (value: SharedArrayBuffer) => { buffer = value; entered(); } }
  });
  const outcome = pending.catch(error => error);
  try {
    await ready;
    controller.abort(new Error("stop atomic waiter"));
    expect(await outcome).toMatchObject({ message: "stop atomic waiter" });
    expect(Atomics.notify(new Int32Array(buffer!), 0)).toBe(0);
  } finally {
    controller.abort();
    if (buffer !== undefined) Atomics.notify(new Int32Array(buffer), 0);
    await outcome;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
});

it("preserves an unrelated native waiter while disposing the run's waiter", async () => {
  const controller = new AbortController();
  let buffer!: SharedArrayBuffer;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const pending = run(`const b=new SharedArrayBuffer(4);
    const waiter=Atomics.waitAsync(new Int32Array(b),0,0);
    entered(b);return await waiter.value`, {
    signal: controller.signal,
    bindings: { entered: (value: SharedArrayBuffer) => { buffer = value; entered(); } }
  });
  const outcome = pending.catch(error => error);
  let other: ReturnType<typeof nativeWait> | undefined;
  try {
    await ready;
    other = nativeWait(new Int32Array(buffer), 0, 0);
    controller.abort(new Error("stop owned waiter"));
    expect(await outcome).toMatchObject({ message: "stop owned waiter" });
    expect(Atomics.notify(new Int32Array(buffer), 0)).toBe(1);
    expect(await other.value).toBe("ok");
  } finally {
    controller.abort();
    if (buffer !== undefined) Atomics.notify(new Int32Array(buffer), 0);
    await outcome;
    if (other !== undefined) await other.value;
  }
});

it("cleans unawaited native waiters when a run completes normally", async () => {
  let buffer!: SharedArrayBuffer;
  const result = await run(`const b=new SharedArrayBuffer(4);
    Atomics.waitAsync(new Int32Array(b),0,0);save(b);return 17`, {
    bindings: { save: (value: SharedArrayBuffer) => { buffer = value; } }
  });
  try {
    expect(result).toMatchObject({ ok: true, returnValue: 17 });
    expect(Atomics.notify(new Int32Array(buffer), 0)).toBe(0);
  } finally { Atomics.notify(new Int32Array(buffer), 0); }
});

it("registers BigInt waits at the original view's byte offset", async () => {
  const result = await run(`const b=new SharedArrayBuffer(16);const a=new BigInt64Array(b,8,1);
    const pending=Atomics.waitAsync(a,0,0n);const count=Atomics.notify(new BigInt64Array(b),1);
    return [pending.async,count,await pending.value]`);
  expect(result).toMatchObject({ ok: true, returnValue: [true, 1, "ok"] });
});

it("preserves immediate wait results and expected-value conversion", async () => {
  const result = await run(`const a=new Int32Array(new SharedArrayBuffer(4));
    const different=Atomics.waitAsync(a,0,1);const zero=Atomics.waitAsync(a,0,0,0);
    const wrapped=Atomics.waitAsync(a,0,4294967296,-1);
    return [different.async,different.value,zero.async,zero.value,wrapped.async,wrapped.value]`);
  expect(result).toMatchObject({ ok: true, returnValue: [false, "not-equal", false, "timed-out", false, "timed-out"] });
});

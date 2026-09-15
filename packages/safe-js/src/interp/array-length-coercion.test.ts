import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { Budget } from "./budget.js";

it("assigns boxed lengths with guest conversion and preserves host prototypes", async () => {
  const keys = Reflect.ownKeys(Number.prototype);
  expect((await run(`const a = []; a.length = new Number(6);
    return [a.length, Object.keys(a).length];`)).returnValue).toEqual([6, 0]);
  expect(Reflect.ownKeys(Number.prototype)).toEqual(keys);
});

it("performs both length conversions through Proxy getters in order", async () => {
  expect((await run(`const log = []; const a = [];
    const value = new Proxy({valueOf() { log.push('call'); return 6; }}, {
      get(target, key, receiver) { log.push(String(key)); return Reflect.get(target, key, receiver); }
    });
    a.length = value;
    return [a.length, log];`)).returnValue).toEqual([6, [
    "Symbol(Symbol.toPrimitive)", "valueOf", "call",
    "Symbol(Symbol.toPrimitive)", "valueOf", "call"
  ]]);
});

it("rejects unequal conversions and preserves the original array", async () => {
  expect((await run(`const a = [1,2,3]; let calls = 0; let rejected = false;
    try { a.length = {valueOf() { return ++calls; }}; }
    catch (e) { rejected = e instanceof RangeError; }
    return [rejected, calls, a];`)).returnValue).toEqual([true, 2, [1, 2, 3]]);
});

it("does not coerce assignments to a nonwritable length", async () => {
  expect((await run(`'use strict'; const a = []; let calls = 0; let rejected = false;
    Object.defineProperty(a, 'length', {writable:false});
    try { a.length = {valueOf() { calls++; return 0; }}; }
    catch (e) { rejected = e instanceof TypeError; }
    return [rejected, calls, a.length];`)).returnValue).toEqual([true, 0, 0]);
});

it("retains truncation failure and descriptor semantics", async () => {
  expect((await run(`const a = [0,1,2]; let rejected = false;
    Object.defineProperty(a, '1', {configurable:false});
    try { a.length = new Number(0); } catch(e) { rejected = e instanceof TypeError; }
    return [rejected, a.length, 2 in a, Object.getOwnPropertyDescriptor(a,'length').writable];`
  )).returnValue).toEqual([true, 2, false, true]);
});

it("propagates second conversion throws without changing length", async () => {
  expect((await run(`const a = [1,2]; let calls = 0;
    try { a.length = {valueOf() { if (++calls === 2) throw 'second'; return 0; }}; }
    catch(e) { return [e, calls, a.length]; }`)).returnValue).toEqual(["second", 2, 2]);
});

it("charges coercion work to the caller's fatal budget", async () => {
  await expect(run(`try { const a = []; a.length = {valueOf() { while(true) {} }}; }
    catch(e) { return 'caught'; } finally { return 'overridden'; }`, {
    budget: new Budget({ maxSteps: 2000 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps", limit: 2000 });
});

it("preserves length conversion through pending and completed replay", async () => {
  const source = `class A extends Array {} const a = new A(1,2,3);
    await 0; a.length = new Number(1); return [a.length, a[0], a instanceof A];`;
  const pending = run(source);
  const settled = pending.catch(error => error);
  try {
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await settled).toMatchObject({ ok: true, returnValue: [1, 1, true] });
    const replay = run(source, { snapshot });
    expect(await replay).toMatchObject({ ok: true, returnValue: [1, 1, true] });
    const completed = restore(JSON.parse(await dump(replay)), { source });
    expect(await run(source, { snapshot: completed })).toMatchObject({ ok: true, returnValue: [1, 1, true] });
  } finally { await settled; }
});

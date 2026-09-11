import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createRealm, defineExtension, run } from "../core.js";
import { Budget } from "./budget.js";

const payload = "'b'.repeat(2000)";
const receiver = `({payload:${payload},value:1,method(){return this.payload.length}})`;
const cases = [
  ["String arguments", `(${payload}).indexOf(allocate())`],
  ["Array arguments", `[${payload}].join(allocate())`],
  ["Map arguments", `(new Map([['key',${payload}]])).get(allocate())`],
  ["Set arguments", `(new Set([${payload}])).has(allocate())`],
  ["Object arguments", `${receiver}.method(allocate())`],
  ["optional call arguments", `${receiver}.method?.(allocate())`],
  ["String key expression", `(${payload})[allocate()]`],
  ["Object key expression", `${receiver}[allocate()]`],
  ["optional key expression", `${receiver}?.[allocate()]`],
  ["call key expression", `${receiver}[allocate()]()`],
  ["assignment key expression", `${receiver}[allocate()]=1`],
  ["delete key expression", `delete ${receiver}[allocate()]`],
  ["update key expression", `${receiver}[allocate()]++`],
  ["read key coercion", `${receiver}[{toString:allocate}]`],
  ["call key coercion", `${receiver}[{toString:allocate}]()`],
  ["assignment key coercion", `${receiver}[{toString:allocate}]=1`],
  ["delete key coercion", `delete ${receiver}[{toString:allocate}]`],
  ["update key coercion", `${receiver}[{toString:allocate}]++`],
  ["assignment right operand", `${receiver}.value=allocate()`],
  ["compound right operand", `${receiver}.value+=allocate()`],
  ["logical right operand", `${receiver}.value&&=allocate()`]
];

describe("member receiver lifetime", () => {
  it.each([false, true])("releases abandoned generator references after run failure=%s", async fail => {
    const budget = new Budget();
    const source = `function* g(){return ${receiver}.method(yield 'pause')}g().next();${fail ? "throw 'failed'" : "return true"}`;
    const execution = run(source, { budget });
    if (fail) await expect(execution).rejects.toThrow("failed");
    else expect(await execution).toMatchObject({ ok: true, returnValue: true });
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it.each([false, true])("keeps a suspended realm reference until resume=%s or close without consuming cleanup quota", async resume => {
    const budget = new Budget();
    let cleanups = 0;
    const extension = defineExtension({ manifest: { version: 1, name: "cleanup-owner" }, setup(context) {
      context.onCleanup(() => { cleanups++; });
      return {};
    } });
    const realm = createRealm({ budget, limits: { cleanups: 1 }, extensions: [extension] });
    try {
      expect(await realm.evaluate(`function* g(){return ({payload:${payload},method(value){return value}}).method(yield 'pause')}const gen=g();return gen.next()`))
        .toMatchObject({ ok: true, returnValue: { value: "pause", done: false } });
      expect([...budget.retainedValues()].length).toBeGreaterThan(0);
      if (resume) {
        expect(await realm.evaluate("return gen.next(7)")).toMatchObject({ ok: true, returnValue: { value: 7, done: true } });
        expect([...budget.retainedValues()]).toEqual([]);
      }
    } finally {
      await realm.close();
    }
    expect([...budget.retainedValues()]).toEqual([]);
    expect(cleanups).toBe(1);
  });

  it("retains the receiver through asynchronous argument evaluation", async () => {
    const source = `async function argument(){await Promise.resolve();const temporary='y'.repeat(5000);throw 'allocated'}
      try{${receiver}.method(await argument())}catch(error){return error}`;
    const rejected = new Budget({ dataSize: 6000 });
    await expect(run(source, { budget: rejected })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect([...rejected.retainedValues()]).toEqual([]);
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: "allocated" });
  });

  it.each([false, true])("releases a reference when its pending argument is cancelled, guest catch=%s", async catches => {
    const budget = new Budget({ dataSize: 6000 });
    const controller = new AbortController();
    const gate = Promise.withResolvers<number>();
    const reached = Promise.withResolvers<void>();
    const argument = catches ? "async function argument(){try{await pause()}catch(error){const temporary='y'.repeat(5000);return 0}}" : "async function argument(){return await pause()}";
    const execution = run(`${argument};return ${receiver}.method(await argument())`, { budget, signal: controller.signal,
      bindings: { pause: () => { reached.resolve(); return gate.promise; } } });
    void execution.catch(() => undefined);
    try {
      await reached.promise;
      expect([...budget.retainedValues()].length).toBeGreaterThan(0);
      controller.abort(new Error("cancelled"));
      if (catches) await expect(execution).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
      else await expect(execution).rejects.toThrow("cancelled");
      expect([...budget.retainedValues()]).toEqual([]);
    } finally {
      gate.resolve(1);
    }
  });

  it.each(cases)("retains receiver through %s", async (_name, expression) => {
    const source = `function allocate(){const temporary='y'.repeat(5000);throw 'allocated'}
      try{${expression}}catch(error){return error}`;
    const rejected = new Budget({ dataSize: 6000 });
    await expect(run(source, { budget: rejected })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect([...rejected.retainedValues()]).toEqual([]);
    expect(() => rejected.reset()).not.toThrow();
    const accepted = new Budget({ dataSize: 14000 });
    expect(await run(source, { budget: accepted })).toMatchObject({ ok: true, returnValue: "allocated" });
    expect([...accepted.retainedValues()]).toEqual([]);
    expect(() => accepted.reset()).not.toThrow();
  });

  it.each([
    "const seen=[];function key(){seen.push('key');return 'method'}function argument(){seen.push('arg');return 2}const o={method(x){seen.push(this===o?'this':'wrong');return x}};return [o[key()](argument()),seen]",
    "const seen=[];const key={toString(){seen.push('key');return 'x'}};function rhs(){seen.push('rhs');return 2}const o={x:1};o[key]=rhs();return [o.x,seen]",
    "const seen=[];function key(){seen.push('key');return 'x'}const o={x:1};return [o[key()]++,o.x,delete o[key()],seen]",
    "let calls=0;function skip(){calls++;throw 'called'}const o=null;return [o?.[skip()],o?.method(skip()),delete o?.[skip()],calls]",
    "const o={method:undefined};let calls=0;return [o.method?.(calls++),calls]",
    "const o={x:0};let calls=0;o.x&&=++calls;return [o.x,calls]"
  ])("preserves native ordering and short-circuit behavior: %s", async source => {
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    const budget = new Budget({ dataSize: 14000 });
    expect(await run(source, { budget })).toMatchObject({ ok: true, returnValue: expected });
    expect([...budget.retainedValues()]).toEqual([]);
    expect(() => budget.reset()).not.toThrow();
  });
});

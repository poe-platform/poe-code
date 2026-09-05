import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";

describe("Object.fromEntries guest construction", () => {
  it.each([
    "const entry=Object.create({0:'key',1:7});return Object.fromEntries([entry])",
    "function* entries(){yield Object.create({0:'key',1:7})}return Object.fromEntries(entries())",
    "function entry(){}entry[0]='key';entry[1]=7;return Object.fromEntries([entry])",
    "const events=[];const key={toString(){events.push('key');return 'name'},valueOf(){throw 'unused'}};return [Object.fromEntries([[key,7]]),events]",
    "const key=Object.create({toString(){return 'name'}});return Object.fromEntries([[key,7]])",
    "const events=[];const key={toString(){events.push('toString');return {}},valueOf(){events.push('valueOf');return 7}};return [Object.fromEntries([[key,9]]),events]",
    "return Object.fromEntries([[{},7]])",
    "function key(){}key.toString=()=> 'name';return Object.fromEntries([[key,7]])",
    "const entry=[];entry[0]={toString(){entry[1]=9;return 'key'}};entry[1]=7;return Object.fromEntries([entry])",
    "const entry=[];entry[0]={toString(){delete entry[1];return 'key'}};entry[1]=7;return Object.fromEntries([entry])",
    "const entries=[];const key={toString(){entries.push(['second',2]);return 'first'}};entries.push([key,1]);return Object.fromEntries(entries)",
    "const entries=[];const key={toString(){entries.length=1;return 'first'}};entries.push([key,1],['second',2]);return Object.fromEntries(entries)",
    "const entries=new Map();const key={toString(){entries.set('second',2);return 'first'}};entries.set(key,1);return Object.fromEntries(entries)",
    "const events=[];const key={async toString(){events.push('before');await 0;events.push('after');return 'ignored'},valueOf(){events.push('fallback');return 'name'}};const result=Object.fromEntries([[key,7]]);events.push('caller');await 0;return [result,events]",
    "const events=[];function* entries(){try{events.push('next');yield [{toString(){events.push('key');throw 7}},1];events.push('tail')}finally{events.push('close')}}try{Object.fromEntries(entries())}catch(error){events.push(error)}return events",
    "const events=[];const reason={};function* entries(){try{yield [{toString(){throw reason}},1]}finally{events.push('close');throw 8}}try{Object.fromEntries(entries())}catch(error){return [error===reason,events]}",
    "const events=[];function* entries(){try{yield 7;events.push('tail')}finally{events.push('close')}}try{Object.fromEntries(entries())}catch(error){events.push(error.name)}return events",
    "const events=[];function* entries(){try{yield [Object.create(null),7]}finally{events.push('close');yield 9;events.push('tail')}}const iterator=entries();try{Object.fromEntries(iterator)}catch(error){events.push(error.name)}return [events,iterator.next()]",
    "const events=[];function* entries(){try{yield ['first',1];throw 7}finally{events.push('close')}}try{Object.fromEntries(entries())}catch(error){events.push(error)}return events",
    "const value={};return Object.fromEntries([['key',value]]).key===value",
    "const promise=Promise.resolve(7);const result=Object.fromEntries([['key',promise]]);return [result.key===promise,await result.key]",
    "function* entries(){yield ['a',/x/];yield ['b',/y/]}const result=Object.fromEntries(entries());return [result.a.test('x'),result.b.test('y')]",
    "return Object.fromEntries(new Set([['first',1],['second',2]]))",
    "return Object.fromEntries(new Map([['first',1],['second',2]]))",
    "return Object.fromEntries([[undefined,1],[null,2],[false,3],[-0,4],['first',5],['first',6]])",
    "const result=Object.fromEntries([['__proto__',7],['constructor',8],['prototype',9]]);return [Object.keys(result),result.__proto__,result.constructor,result.prototype,Object.getPrototypeOf(result)===Object.prototype]",
    "const result=Object.fromEntries([['key',7]]);return Object.getOwnPropertyDescriptor(result,'key')",
    "function Unused(){throw 7}const from=Object.fromEntries;return [from([]),from.call(Unused,[['key',7]])]",
    "return Object.fromEntries([[]])",
    "try{Object.fromEntries('ab')}catch(error){return error.name}",
    "try{Object.fromEntries([null])}catch(error){return error.name}"
  ])("matches native entry construction: %s", async (source) => {
    const wrapped = `try{${source}}catch(error){return ['uncaught',error.name]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${wrapped}})()`, {}, { timeout: 1000 });
    expect(await run(wrapped)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["undefined", "null", "false", "0", "''"])("preserves a falsey key-conversion throw through cleanup: %s", async (reason) => {
    expect(await run(`const reason=${reason};function* entries(){try{yield [{toString(){throw reason}},7]}finally{throw 8}}try{Object.fromEntries(entries())}catch(error){return error===reason}`))
      .toMatchObject({ ok: true, returnValue: true });
  });

  it("retains identity and inherited entry fields across realm evaluations", async () => {
    const realm = createRealm();
    try {
      await realm.evaluate("const value={};const entry=Object.create({0:'key',1:value});const result=Object.fromEntries([entry]);");
      expect(await realm.evaluate("return [result.key===value,Object.keys(result)]"))
        .toMatchObject({ ok: true, returnValue: [true, ["key"]] });
    } finally {
      await realm.close();
    }
  });

  it("preserves completed construction replay", async () => {
    const source = "const key={toString(){return 'name'}};return Object.fromEntries([[key,7]])";
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: { name: 7 } });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) }))
      .toMatchObject({ ok: true, returnValue: { name: 7 } });
  });

  it("retains previous entries while the generator allocates its next value", async () => {
    const source = "function* entries(){yield ['a',{value:'x'.repeat(2000)}];const temporary='y'.repeat(2000);yield ['b',{value:'z'.repeat(2000)}]}return Object.fromEntries(entries()).b.value.length";
    await expect(run(source, { budget: new Budget({ dataSize: 5000 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 7000 }) }))
      .toMatchObject({ ok: true, returnValue: 2000 });
  });

  it("retains the already-read value while key conversion removes its input reference", async () => {
    const source = "const entry=[];entry[0]={toString(){delete entry[1];const a={value:'y'.repeat(2000)};const b={value:'z'.repeat(2000)};return 'key'}};entry[1]='x'.repeat(2000);return Object.fromEntries([entry]).key.length";
    await expect(run(source, { budget: new Budget({ dataSize: 5000 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 7000 }) }))
      .toMatchObject({ ok: true, returnValue: 2000 });
  });

  it("enforces data size before draining a generator", async () => {
    await expect(run("function* entries(){for(let i=0;i<1000;i++)yield [String(i),undefined]}return Object.fromEntries(entries())", {
      budget: new Budget({ dataSize: 100, maxSteps: 1000 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  });

  it("does not hide a fatal cleanup budget behind a key-conversion throw", async () => {
    await expect(run("function* entries(){try{yield [{toString(){throw 7}},1]}finally{while(true){}}}try{Object.fromEntries(entries())}catch(error){return 'caught'}", {
      budget: new Budget({ maxSteps: 1000 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it("does not rescan the whole graph after every primitive property", async () => {
    const budget = new Budget({ dataSize: 1000000 });
    const reconcile = vi.spyOn(budget, "reconcileCompileData");
    const entries = Array.from({ length: 5000 }, (_, index) => [String(index), index]);
    expect(await run("return Object.keys(Object.fromEntries(entries)).length", { budget, bindings: { entries } }))
      .toMatchObject({ ok: true, returnValue: 5000 });
    expect(reconcile.mock.calls.length).toBeLessThan(100);
  });

  it("does not rescan the whole graph after every already-rooted object property", async () => {
    const budget = new Budget({ dataSize: 1000000 });
    const reconcile = vi.spyOn(budget, "reconcileCompileData");
    const entries = Array.from({ length: 1000 }, (_, index) => [String(index), { value: index }]);
    expect(await run("return Object.keys(Object.fromEntries(entries)).length", { budget, bindings: { entries } }))
      .toMatchObject({ ok: true, returnValue: 1000 });
    expect(reconcile.mock.calls.length).toBeLessThan(100);
  });
});

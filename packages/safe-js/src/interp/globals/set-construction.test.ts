import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";
import { createSandboxMap, isSandboxSet, type SandboxValue } from "../values.js";
import { createCollectionGlobals } from "./collections.js";

describe("Set iterable construction", () => {
  it.each([
    "return [...new Set(new Map([['a',1],['b',2]]))]",
    "return [...new Set(new Float32Array([1,2,1]))]",
    "return new Set(new Float32Array(0)).size",
    "const key={};const value={};const set=new Set(new Map([[key,value]]));const entry=[...set][0];return [entry[0]===key,entry[1]===value]",
    "const value={};const original=new Set([value]);const copy=new Set(original);return [copy!==original,copy.has(value),[...copy][0]===value]",
    "const value={toString(){throw 'unused'}};return new Set([value,value]).size",
    "return [...new Set('💡💡a')]",
    "return [...new Set([NaN,NaN,-0,0])].map(value=>[String(value),Object.is(value,-0)])",
    "const promise=Promise.resolve(7);const set=new Set([promise]);return [set.has(promise),await [...set][0]]",
    "function value(){}const set=new Set([value,value]);return [set.size,set.has(value)]",
    "function* values(){const value={count:1};yield value;value.count=2;yield value}const set=new Set(values());return [set.size,[...set][0].count]",
    "function* values(){try{yield 1}finally{yield 2}}return [...new Set(values())]",
    "function* values(){yield /x/;yield /y/}return [...new Set(values())].map(value=>value.test('xy'))",
    "const events=[];function* values(){Promise.resolve().then(()=>events.push('queued'));yield 1;events.push('tail')}new Set(values());events.push('caller');await 0;return events",
    "return [new Set().size,new Set(undefined).size,new Set(null).size,new Set('').size]",
    "try{new Set(1)}catch(error){return error.name}",
    "try{new Set(false)}catch(error){return error.name}",
    "try{new Set({length:0})}catch(error){return error.name}"
  ])("matches native construction: %s", async (source) => {
    const wrapped = `try{${source}}catch(error){return ['uncaught',error.name]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${wrapped}})()`, {}, { timeout: 1000 });
    expect(await run(wrapped)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["undefined", "null", "false", "0", "''", "{}"])("preserves an iterator throwing %s", async (reason) => {
    expect(await run(`const reason=${reason};function* values(){yield 1;throw reason}try{new Set(values())}catch(error){return error===reason}`))
      .toMatchObject({ ok: true, returnValue: true });
  });

  it("retains previous values during generator allocation", async () => {
    const source = "function* values(){yield {value:'x'.repeat(2000)};const temporary='y'.repeat(2000);yield {value:'z'.repeat(2000)}}return new Set(values()).size";
    await expect(run(source, { budget: new Budget({ dataSize: 5000 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 7000 }) }))
      .toMatchObject({ ok: true, returnValue: 2 });
  });

  it("checks capacity before consuming the generator's later body", async () => {
    const events: string[] = [];
    await expect(run("function* values(){try{yield 1;yield 2;record('tail')}finally{record('close')}}return new Set(values())", {
      budget: new Budget({ arrayLength: 1 }), bindings: { record: (event: string) => { events.push(event); } }
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
    expect(events).not.toContain("tail");
  });

  it("keeps the original capacity budget when cleanup also exhausts a budget", async () => {
    await expect(run("function* values(){try{yield 1;yield 2}finally{while(true){}}}return new Set(values())", {
      budget: new Budget({ arrayLength: 1, maxSteps: 1000 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
  });

  it("charges traversal when all input values are duplicates", async () => {
    const values = Array.from({ length: 1000 }, () => 1);
    await expect(run("return new Set(values).size", { budget: new Budget({ maxSteps: 100 }), bindings: { values } }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it("charges capacity only for unique values", async () => {
    expect(await run("function* values(){yield 1;yield 1;yield 1}return new Set(values()).size", {
      budget: new Budget({ arrayLength: 1 })
    })).toMatchObject({ ok: true, returnValue: 1 });
  });

  it("preserves Map entry values across realm evaluations", async () => {
    const realm = createRealm();
    try {
      expect(await realm.evaluate("const value={};const set=new Set(new Map([['key',value]]));")).toMatchObject({ ok: true });
      expect(await realm.evaluate("return [...set][0][1]===value")).toMatchObject({ ok: true, returnValue: true });
    } finally { await realm.close(); }
  });

  it("preserves completed construction replay", async () => {
    const source = "return [...new Set(new Map([['a',1],['b',2]]))]";
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: [["a", 1], ["b", 2]] });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) }))
      .toMatchObject({ ok: true, returnValue: [["a", 1], ["b", 2]] });
  });

  it("keeps supported synchronous iterable construction synchronous", () => {
    const value = { answer: 7 };
    const set = createCollectionGlobals({ budget: new Budget() }).Set.construct?.([createSandboxMap([["key", value]])]);
    expect(set).not.toBeInstanceOf(Promise);
    expect(isSandboxSet(set)).toBe(true);
    if (isSandboxSet(set)) {
      const entry = [...set.values][0];
      expect(Array.isArray(entry)).toBe(true);
      if (Array.isArray(entry)) expect(entry[1]).toBe(value);
    }
  });

  it.each([undefined, 10000])("does not inspect stored properties with data limit %s", (dataSize) => {
    const reads: string[] = [];
    const value = { get property() { reads.push("read"); return 7; } };
    const set = createCollectionGlobals({ budget: new Budget({ dataSize }) }).Set.construct?.([[value]]);
    expect(isSandboxSet(set)).toBe(true);
    if (isSandboxSet(set)) expect(set.values.has(value)).toBe(true);
    expect(reads).toEqual([]);
  });

  it.each(["next", "done", "value"])("preserves native synchronous iterator errors at %s", (failure) => {
    const reason = new Error(failure);
    const iterable = (events: string[]) => ({
      [Symbol.iterator]() {
        return {
          next() {
            events.push("next");
            if (failure === "next") throw reason;
            return {
              get done() { events.push("done"); if (failure === "done") throw reason; return false; },
              get value() { events.push("value"); throw reason; }
            };
          },
          return() { events.push("close"); throw new Error("cleanup"); }
        };
      }
    });
    const nativeEvents: string[] = [];
    expect(() => Reflect.construct(Set, [iterable(nativeEvents)])).toThrow(reason);
    const events: string[] = [];
    const constructor = createCollectionGlobals({ budget: new Budget() }).Set;
    expect(() => constructor.construct?.([iterable(events) as unknown as SandboxValue])).toThrow(reason);
    expect(events).toEqual(nativeEvents);
  });

  it("does not rescan all roots after every object value", async () => {
    const budget = new Budget({ dataSize: 1000000 });
    const reconcile = vi.spyOn(budget, "reconcileCompileData");
    const values = Array.from({ length: 1000 }, (_, index) => ({ value: index }));
    expect(await run("return new Set(values).size", { budget, bindings: { values } }))
      .toMatchObject({ ok: true, returnValue: 1000 });
    expect(reconcile.mock.calls.length).toBeLessThan(100);
  });
});

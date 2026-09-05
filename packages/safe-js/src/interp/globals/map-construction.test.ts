import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";
import { createSandboxSet, isSandboxMap, type SandboxValue } from "../values.js";
import { createCollectionGlobals } from "./collections.js";

describe("Map iterable construction", () => {
  it.each([
    "return [...new Map(new Set([['a',1],['b',2]]))]",
    "return new Map('').size",
    "return new Map(new Float32Array(0)).size",
    "return new Map([{0:'key',1:7}]).get('key')",
    "return new Map([Object.create({0:'key',1:7})]).get('key')",
    "function entry(){}entry[0]='key';entry[1]=7;return new Map([entry]).get('key')",
    "function* entries(){yield Object.create({0:'key',1:7})}return new Map(entries()).get('key')",
    "function* entries(){const pair=['a',1];yield pair;pair[0]='b';pair[1]=2;yield pair}return [...new Map(entries())]",
    "const events=[];function* entries(){try{yield 7;events.push('tail')}finally{events.push('close')}}try{new Map(entries())}catch(error){events.push(error.name)}return events",
    "const events=[];function* entries(){try{yield 7;throw 'late'}finally{events.push('close')}}try{new Map(entries())}catch(error){return [typeof error,error.name,events]}",
    "const events=[];function* entries(){try{yield 7}finally{events.push('close');throw 'cleanup'}}try{new Map(entries())}catch(error){return [typeof error,error.name,events]}",
    "const events=[];function* entries(){try{yield null}finally{events.push('close');yield 9;events.push('tail')}}const iterator=entries();try{new Map(iterator)}catch(error){events.push(error.name)}return [events,iterator.next()]",
    "const key={toString(){throw 'unused'}};const value={};const map=new Map([[key,value]]);return [map.get(key)===value,[...map][0][0]===key]",
    "const value={};const source=new Map([['key',value]]);const copy=new Map(source);return [copy!==source,copy.get('key')===value]",
    "const promise=Promise.resolve(7);const map=new Map([['key',promise]]);return [map.get('key')===promise,await map.get('key')]",
    "return [...new Map([[NaN,1],[NaN,2],[-0,3],[0,4]])].map(entry=>[String(entry[0]),entry[1]])",
    "return [...new Map([[],['key'],['key',7],['last',8]])]",
    "try{new Map('a')}catch(error){return error.name}",
    "try{new Map(new Float32Array([1]))}catch(error){return error.name}",
    "try{new Map(new Set([1]))}catch(error){return error.name}",
    "const reason={};function* entries(){yield ['key',7];throw reason}try{new Map(entries())}catch(error){return error===reason}",
    "function* entries(){yield ['a',/x/];yield ['b',/y/]}const map=new Map(entries());return [map.get('a').test('x'),map.get('b').test('y')]"
  ])("matches native construction: %s", async (source) => {
    const wrapped = `try{${source}}catch(error){return ['uncaught',error.name]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${wrapped}})()`, {}, { timeout: 1000 });
    expect(await run(wrapped)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["undefined", "null", "false", "0", "''"])("preserves the invalid-entry error against cleanup throwing %s", async (reason) => {
    expect(await run(`function* entries(){try{yield 7}finally{throw ${reason}}}try{new Map(entries())}catch(error){return error instanceof TypeError}`))
      .toMatchObject({ ok: true, returnValue: true });
  });

  it("retains previously inserted values during generator allocation", async () => {
    const source = "function* entries(){yield ['a',{value:'x'.repeat(2000)}];const temporary='y'.repeat(2000);yield ['b',{value:'z'.repeat(2000)}]}return new Map(entries()).get('b').value.length";
    await expect(run(source, { budget: new Budget({ dataSize: 5000 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 7000 }) }))
      .toMatchObject({ ok: true, returnValue: 2000 });
  });

  it("checks collection size before consuming later entries", async () => {
    const events: string[] = [];
    await expect(run("function* entries(){try{yield ['a',1];yield ['b',2];yield ['c',3];record('tail')}finally{record('close')}}return new Map(entries())", {
      budget: new Budget({ arrayLength: 2 }), bindings: { record: (event: string) => { events.push(event); } }
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
    expect(events).not.toContain("tail");
  });

  it("does not hide a fatal cleanup budget behind an invalid entry", async () => {
    await expect(run("function* entries(){try{yield 7}finally{while(true){}}}try{new Map(entries())}catch(error){return 'caught'}", {
      budget: new Budget({ maxSteps: 1000 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it("charges traversal work even when all entries overwrite one key", async () => {
    const entries = Array.from({ length: 1000 }, () => ["key", 1]);
    await expect(run("return new Map(entries).size", {
      budget: new Budget({ maxSteps: 100 }), bindings: { entries }
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it("charges collection capacity for unique keys rather than consumed entries", async () => {
    expect(await run("function* entries(){yield ['key',1];yield ['key',2];yield ['key',3]}return new Map(entries()).size", {
      budget: new Budget({ arrayLength: 2 })
    })).toMatchObject({ ok: true, returnValue: 1 });
  });

  it("preserves identity across realm evaluations", async () => {
    const realm = createRealm();
    try {
      expect(await realm.evaluate("const value={};const map=new Map([Object.create({0:'key',1:value})]);"))
        .toMatchObject({ ok: true });
      expect(await realm.evaluate("return map.get('key')===value")).toMatchObject({ ok: true, returnValue: true });
    } finally { await realm.close(); }
  });

  it("preserves completed construction replay", async () => {
    const source = "function* entries(){const pair=['a',1];yield pair;pair[0]='b';pair[1]=2;yield pair}return [...new Map(entries())]";
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: [["a", 1], ["b", 2]] });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) }))
      .toMatchObject({ ok: true, returnValue: [["a", 1], ["b", 2]] });
  });

  it("constructs supported synchronous iterables synchronously", () => {
    const constructor = createCollectionGlobals({ budget: new Budget() }).Map;
    const value = { answer: 7 };
    const map = constructor.construct?.([createSandboxSet([["key", value]])]);
    expect(map).not.toBeInstanceOf(Promise);
    expect(isSandboxMap(map)).toBe(true);
    if (isSandboxMap(map)) expect(map.entries.get("key")).toBe(value);
  });

  it.each([
    ["key", undefined], ["value", undefined], ["key", 10000], ["value", 10000]
  ] as const)("does not inspect stored %s properties with data limit %s", (field, dataSize) => {
    const reads: string[] = [];
    const opaque = { get property() { reads.push("read"); return 7; } };
    const key = field === "key" ? opaque : "key";
    const value = field === "value" ? opaque : 7;
    const constructor = createCollectionGlobals({ budget: new Budget({ dataSize }) }).Map;
    const map = constructor.construct?.([[[key, value]]]);
    expect(isSandboxMap(map)).toBe(true);
    if (isSandboxMap(map)) expect(map.entries.get(key)).toBe(value);
    expect(reads).toEqual([]);
  });

  it.each(["next", "done", "value", "entry-key", "entry-value"])("preserves native synchronous cleanup after %s fails", (failure) => {
    const reason = new Error(failure);
    const iterable = (events: string[]) => ({
      [Symbol.iterator]() {
        return {
          next() {
            events.push("next");
            if (failure === "next") throw reason;
            return {
              get done() { events.push("done"); if (failure === "done") throw reason; return false; },
              get value() {
                events.push("value");
                if (failure === "value") throw reason;
                return {
                  get 0() { events.push("key"); if (failure === "entry-key") throw reason; return "key"; },
                  get 1() { events.push("entry-value"); throw reason; }
                };
              }
            };
          },
          return() { events.push("close"); throw new Error("cleanup"); }
        };
      }
    });
    const nativeEvents: string[] = [];
    expect(() => Reflect.construct(Map, [iterable(nativeEvents)])).toThrow(reason);
    const events: string[] = [];
    const constructor = createCollectionGlobals({ budget: new Budget() }).Map;
    expect(() => constructor.construct?.([iterable(events) as unknown as SandboxValue])).toThrow(reason);
    expect(events).toEqual(nativeEvents);
  });

  it("does not reconcile all roots after every inserted object", async () => {
    const budget = new Budget({ dataSize: 1000000 });
    const reconcile = vi.spyOn(budget, "reconcileCompileData");
    const entries = Array.from({ length: 1000 }, (_, index) => [index, { value: index }]);
    expect(await run("return new Map(entries).size", { budget, bindings: { entries } }))
      .toMatchObject({ ok: true, returnValue: 1000 });
    expect(reconcile.mock.calls.length).toBeLessThan(100);
  });
});

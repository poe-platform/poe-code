import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { createSandboxCollectionIterator, nextCollectionIterator } from "../collection-iterator.js";
import { createSandboxMap, createSandboxSet, measureSandboxData } from "../values.js";
import { callMapMethod } from "./map.js";
import { callSetMethod } from "./set.js";

describe("live collection method iterators", () => {
  it.each([
    "const iterator=new Map([['a',1]]).keys();return [typeof iterator.next,Array.isArray(iterator),iterator.length,typeof iterator.return,typeof iterator.throw,Object.keys(iterator)]",
    "const iterator=new Set([1]).values();return [typeof iterator.next,Array.isArray(iterator),iterator.length,typeof iterator.return,typeof iterator.throw,Object.keys(iterator)]",
    "const iterator=new Map().keys();return ['next' in iterator,'return' in iterator,Object.hasOwn(iterator,'next')]",
    "const iterator=new Set().values();return ['next' in iterator,'throw' in iterator,Object.hasOwn(iterator,'next')]",
    "const iterator=new Map().keys();return [String(iterator),Object.prototype.toString.call(iterator)]",
    "const iterator=new Set().values();return [String(iterator),Object.prototype.toString.call(iterator)]",
    "const iterator=new Map([['a',1],['b',2]]).keys();return [iterator.next(),iterator.next(),iterator.next(),iterator.next()]",
    "const iterator=new Map([['a',1],['b',2]]).values();return [iterator.next(),iterator.next(),iterator.next()]",
    "const iterator=new Map([['a',1],['b',2]]).entries();return [iterator.next(),iterator.next(),iterator.next()]",
    "const iterator=new Set([1,2]).keys();return [iterator.next(),iterator.next(),iterator.next()]",
    "const iterator=new Set([1,2]).values();return [iterator.next(),iterator.next(),iterator.next()]",
    "const iterator=new Set([1,2]).entries();return [iterator.next(),iterator.next(),iterator.next()]",
    "const map=new Map([['a',1]]);const iterator=map.keys();map.set('b',2);return [...iterator]",
    "const map=new Map([['a',1]]);const iterator=map.values();map.set('a',7);return [...iterator]",
    "const map=new Map([['a',1],['b',2]]);const iterator=map.entries();map.delete('a');map.set('b',7);return [...iterator]",
    "const map=new Map([['a',1],['b',2]]);const iterator=map.keys();const first=iterator.next();map.delete('a');map.set('a',9);return [first,[...iterator]]",
    "const map=new Map([['a',1],['b',2]]);const iterator=map.keys();const first=iterator.next();map.clear();map.set('c',3);return [first,[...iterator]]",
    "const map=new Map([['a',1]]);const iterator=map.keys();const first=iterator.next();map.set('b',2);return [first,[...iterator]]",
    "const map=new Map([['a',1]]);const iterator=map.keys();iterator.next();iterator.next();map.set('b',2);return [iterator.next(),[...iterator]]",
    "const map=new Map();const iterator=map.keys();map.set('a',1);return [...iterator]",
    "const map=new Map();const iterator=map.keys();iterator.next();map.set('a',1);return [...iterator]",
    "const set=new Set([1]);const iterator=set.values();set.add(2);return [...iterator]",
    "const set=new Set([1,2]);const iterator=set.values();set.delete(1);return [...iterator]",
    "const set=new Set([1,2]);const iterator=set.values();const first=iterator.next();set.delete(1);set.add(1);return [first,[...iterator]]",
    "const set=new Set([1,2]);const iterator=set.values();const first=iterator.next();set.clear();set.add(3);return [first,[...iterator]]",
    "const set=new Set([1]);const iterator=set.values();iterator.next();iterator.next();set.add(2);return [iterator.next(),[...iterator]]",
    "const iterator=new Map([['a',1]]).keys();return [[...iterator],[...iterator]]",
    "const iterator=new Set([1]).entries();return [[...iterator],[...iterator]]",
    "const iterator=new Map([['a',1],['b',2]]).keys();let first;for(const key of iterator){first=key;break}return [first,[...iterator]]",
    "const iterator=new Set([1,2]).values();let first;for(const key of iterator){first=key;break}return [first,[...iterator]]",
    "const iterator=new Set([1,2,3]).values();const [first]=iterator;return [first,[...iterator]]",
    "const iterator=new Set([1,2,3]).values();const [,second,...rest]=iterator;return [second,rest,[...iterator]]",
    "const set=new Set([undefined,2]);const iterator=set.values();const [first=(set.add(3),7),...rest]=iterator;return [first,rest]",
    "const iterator=new Set([1,2]).values();try{for(const entry of iterator){throw entry}}catch(error){}return [...iterator]",
    "function* values(){yield* new Map([['a',1],['b',2]]).values()}return [...values()]",
    "return await Promise.all(new Set([Promise.resolve(1),Promise.resolve(2)]).values())",
    "return Object.fromEntries(new Map([['a',1],['b',2]]).entries())",
    "const iterator=new Map([['a',1]]).keys();try{structuredClone(iterator);return false}catch(error){return iterator.next().value==='a'}",
    "const iterator=new Set([1]).values();try{structuredClone(iterator);return false}catch(error){return iterator.next().value===1}",
    "const iterator=new Set([1]).values();try{structuredClone({nested:new Map([['iterator',iterator]])});return false}catch(error){return iterator.next().value===1}",
    "const iterator=new Map([['a',1],['b',2]]).entries();return [[...new Map(iterator)],[...iterator]]",
    "const iterator=new Set([1,2]).values();return [[...new Set(iterator)],[...iterator]]",
    "const iterator=new Map([['a',1]]).values();return [Array.from(iterator),Array.from(iterator)]",
    "const iterator=new Set([1,2]).entries();const first=iterator.next().value;const second=iterator.next().value;return [first===second,first,second]",
    "const a=new Map([['a',1]]).keys();const b=new Map([['b',2]]).values();return [a.next.call(b),a.next()]",
    "const a=new Set([1]).keys();const b=new Set([2]).entries();return [a.next.apply(b,[]),a.next()]",
    "const a=new Map().keys();try{a.next.call(new Set().values())}catch(error){return error.name}",
    "const a=new Set().values();try{a.next.call(new Map().keys())}catch(error){return error.name}",
    "const iterator=new Map().keys();try{const next=iterator.next;next()}catch(error){return error.name}",
    "const iterator=new Set().values();try{iterator.next.call({})}catch(error){return error.name}"
  ])("matches native iteration: %s", async source => {
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`, { structuredClone }, { timeout: 1000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    ["new Map([['a',1],['b',2]])", "keys", "collection.set('c',3)", ["b", "c"]],
    ["new Set([1,2])", "values", "collection.add(3)", [2, 3]]
  ] as const)("retains live cursor across realm evaluations: %s", async (initial, method, mutate, expected) => {
    const realm = createRealm();
    try {
      expect(await realm.evaluate(`const collection=${initial};const iterator=collection.${method}();iterator.next();`)).toMatchObject({ ok: true });
      expect(await realm.evaluate(`${mutate};return [...iterator]`)).toMatchObject({ ok: true, returnValue: expected });
    } finally { await realm.close(); }
  });

  it.each(["map", "set"] as const)("accounts for the retained %s source and releases it at exhaustion", kind => {
    const collection = kind === "map" ? createSandboxMap([["a", "x".repeat(2000)], ["b", "y".repeat(2000)]]) : createSandboxSet(["x".repeat(2000), "y".repeat(2000)]);
    const iterator = createSandboxCollectionIterator(collection, "keys");
    expect(measureSandboxData([iterator])).toBe(1 + measureSandboxData([collection]));
    nextCollectionIterator(iterator);
    nextCollectionIterator(iterator);
    expect(measureSandboxData([iterator])).toBe(1 + measureSandboxData([collection]));
    nextCollectionIterator(iterator);
    expect(measureSandboxData([iterator])).toBe(1);
  });

  it.each([
    "const collection=new Map();collection.set('a','x'.repeat(2000));collection.set('b','y'.repeat(2000));return collection.keys()",
    "const collection=new Set();collection.add('x'.repeat(2000));collection.add('y'.repeat(2000));return collection.values()"
  ])("keeps iterator-only source data within the live budget: %s", async create => {
    const source = `const iterator=(()=>{${create}})();const temporary='z'.repeat(2000);return typeof iterator.next`;
    const baseline = new Budget();
    await run(`const iterator=(()=>{${create}})();return typeof iterator.next`, { budget: baseline });
    await expect(run(source, { budget: new Budget({ dataSize: baseline.peakDataSize + 1000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: baseline.peakDataSize + 3000 }) })).toMatchObject({ ok: true, returnValue: "function" });
  });

  it.each(["keys", "values", "entries"] as const)("does not inspect stored properties when creating or advancing %s", async method => {
    const reads: string[] = [];
    const value = { get hidden() { reads.push("read"); return 1; } };
    const options = { budget: new Budget(), callClosure: async () => undefined };
    const mapIterator = await callMapMethod(createSandboxMap([[value, value]]), method, [], options);
    const setIterator = await callSetMethod(createSandboxSet([value]), method, [], options);
    expect(reads).toEqual([]);
    // The public guest flow is covered above; here values remain opaque host fixtures.
    const map = mapIterator as ReturnType<typeof createSandboxCollectionIterator>;
    const set = setIterator as ReturnType<typeof createSandboxCollectionIterator>;
    nextCollectionIterator(map, options.budget);
    nextCollectionIterator(set, options.budget);
    expect(reads).toEqual([]);
  });

  it("checks entry-pair allocation when advancing, not when creating the iterator", () => {
    const iterator = createSandboxCollectionIterator(createSandboxMap([[1, 2]]), "entries");
    expect(() => nextCollectionIterator(iterator, new Budget({ arrayLength: 1 }))).toThrowError(expect.objectContaining({ code: "budgetExceeded", budget: "arrayLength" }));
  });
});

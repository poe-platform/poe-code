import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";

describe("collection method receivers", () => {
  it.each([
    "const a=new Map([['a',1]]);const b=new Map([['b',2]]);return a.get.call(b,'b')",
    "const a=new Map();const b=new Map();return [a.set.call(b,'key',7)===b,[...a],[...b]]",
    "const a=new Map([['a',1]]);const b=new Map([['b',2]]);return a.has.call(b,'b')",
    "const a=new Map([['a',1]]);const b=new Map([['b',2]]);return [a.delete.call(b,'b'),[...a],[...b]]",
    "const a=new Map([['a',1]]);const b=new Map([['b',2]]);a.clear.call(b);return [a.size,b.size]",
    "const a=new Map([['a',1]]);const b=new Map([['b',2]]);const seen=[];a.forEach.call(b,(v,k,map)=>seen.push([v,k,map===b]));return seen",
    "const a=new Map([['a',1]]);const b=new Map([['b',2]]);return [...a.keys.call(b)]",
    "const a=new Map([['a',1]]);const b=new Map([['b',2]]);return [...a.values.call(b)]",
    "const a=new Map([['a',1]]);const b=new Map([['b',2]]);return [...a.entries.call(b)]",
    "const a=new Set([1]);const b=new Set([2]);return [a.add.call(b,3)===b,[...a],[...b]]",
    "const a=new Set([1]);const b=new Set([2]);return a.has.call(b,2)",
    "const a=new Set([1]);const b=new Set([2]);return [a.delete.call(b,2),[...a],[...b]]",
    "const a=new Set([1]);const b=new Set([2]);a.clear.call(b);return [a.size,b.size]",
    "const a=new Set([1]);const b=new Set([2]);const seen=[];a.forEach.call(b,(v,k,set)=>seen.push([v,k,set===b]));return seen",
    "const a=new Set([1]);const b=new Set([2]);return [...a.keys.call(b)]",
    "const a=new Set([1]);const b=new Set([2]);return [...a.values.call(b)]",
    "const a=new Set([1]);const b=new Set([2]);return [...a.entries.call(b)]",
    "const a=new Map([['a',1]]);const b=new Map([['b',2]]);return [a.get.apply(b,['b']),a.get.bind(b)('b')]",
    "const a=new Set([1]);const b=new Set([2]);return [a.has.apply(b,[2]),a.has.bind(b)(2)]",
    "const a=new Map([['a',1]]);const b=new Map([['b',2]]);const receiver={tag:'receiver'};const seen=[];a.forEach.call(b,function(v,k,map){seen.push([this===receiver,v,k,map===b])},receiver);return seen",
    "const a=new Set([1]);const b=new Set([2]);const receiver={tag:'receiver'};const seen=[];a.forEach.call(b,function(v,k,set){seen.push([this===receiver,v,k,set===b])},receiver);return seen",
    "const a=new Map([['a',1]]);const b=new Map([['b',2]]);const seen=[];a.forEach.call(b,async(v)=>{seen.push(v);await 0;seen.push('after')});seen.push('caller');await 0;return seen",
    "const a=new Set([1]);const b=new Set([2]);const seen=[];a.forEach.call(b,async(v)=>{seen.push(v);await 0;seen.push('after')});seen.push('caller');await 0;return seen",
    "const a=new Map([['a',1]]);const b=new Map([['b',2]]);const seen=[];a.forEach.call(b,(v,k,map)=>{seen.push(k);if(k==='b')map.set('c',3)});return [seen,[...a],[...b]]",
    "const a=new Set([1]);const b=new Set([2]);const seen=[];a.forEach.call(b,(v,k,set)=>{seen.push(v);if(v===2)set.add(3)});return [seen,[...a],[...b]]"
  ])("matches native receiver behavior: %s", async (source) => {
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`, {}, { timeout: 1000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  describe.each([
    { kind: "Map", method: "get", source: "new Map([['key',7]])", other: "new Set()", expected: 7 },
    { kind: "Set", method: "has", source: "new Set(['key'])", other: "new Map()", expected: true }
  ])("$kind method branding", ({ method, source, other, expected }) => {
    it.each(["undefined", "null", "0", "''", "{}", "[]", other])("rejects receiver %s", async (receiver) => {
      expect(await run(`const collection=${source};try{collection.${method}.call(${receiver},'key')}catch(error){return error.name}`))
        .toMatchObject({ ok: true, returnValue: "TypeError" });
    });

    it.each([
      `const method=collection.${method};method('key')`,
      `const {${method}:method}=collection;method('key')`,
      `const holder={method:collection.${method}};holder.method('key')`,
      `const method=collection.${method}.bind(undefined);method('key')`
    ])("does not bind a detached method: %s", async (call) => {
      expect(await run(`const collection=${source};try{${call}}catch(error){return error.name}`))
        .toMatchObject({ ok: true, returnValue: "TypeError" });
    });

    it("preserves ordinary and optional member calls", async () => {
      expect(await run(`const collection=${source};return [collection.${method}('key'),collection.${method}?.('key'),collection?.${method}('key')]`))
        .toMatchObject({ ok: true, returnValue: [expected, expected, expected] });
    });
  });

  it.each(["new Map([['key',7]])", "new Set([7])"])("checks %s receivers before invoking callbacks", async (source) => {
    expect(await run(`const collection=${source};const events=[];try{collection.forEach.call({},()=>events.push('called'))}catch(error){return [error.name,events]}`))
      .toMatchObject({ ok: true, returnValue: ["TypeError", []] });
  });

  it.each([
    ["new Map([['a',1]])", "new Map([['b',2]])", [[2, "b", true]]],
    ["new Set([1])", "new Set([2])", [[2, 2, true]]]
  ] as const)("uses the receiver across realm evaluations: %s", async (source, receiver, expected) => {
    const realm = createRealm();
    try {
      expect(await realm.evaluate(`const collection=${source};const receiver=${receiver};const each=collection.forEach;`))
        .toMatchObject({ ok: true });
      expect(await realm.evaluate("const seen=[];each.call(receiver,(v,k,target)=>seen.push([v,k,target===receiver]));return seen"))
        .toMatchObject({ ok: true, returnValue: expected });
    } finally { await realm.close(); }
  });

  it("preserves completed receiver-call replay", async () => {
    const source = "const a=new Map([['a',1]]);const b=new Map([['b',2]]);return a.get.call(b,'b')";
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: 2 });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) })).toMatchObject({ ok: true, returnValue: 2 });
  });
});

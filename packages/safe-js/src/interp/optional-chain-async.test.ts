import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { dump } from "../dump.js";
import { run } from "../run.js";

it.each([
  "missing?.a[await effect()]",
  "missing?.[await effect()].a",
  "missing?.a(await effect()).b",
  "missing?.(await effect()).a",
  "missing?.a.b?.(await effect())",
  "(missing?.a)?.(await effect()).b",
  "(missing?.a)(await effect())",
  "({a:undefined})?.a?.(await effect()).b",
  "({a:undefined})?.a(await effect())",
  "({a:async function(value){return {value}}})?.a(await effect())",
  "({a:[3,7]})?.a[await Promise.resolve(1)]",
  "(await Promise.resolve(null))?.a.b",
  "delete missing?.a[await effect()]"
])("preserves async optional-chain order: %s", async expression => {
  const source=`const missing=null;let effects=0,value;
    async function effect(){effects++;await 0;return 'effect'}
    try{value=await (${expression})}catch(error){value=error.name}
    return [value,effects];`;
  const expected=await runInNewContext("(async()=>{'use strict';"+source+"})()");
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it("does not create rejected promises in skipped chain operands", async () => {
  const source="let effects=0;const absent=undefined;const value=absent?.a[await Promise.reject(++effects)];await 0;return [value,effects]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:[undefined,0]});
});

it("looks up promise properties before awaiting optional-chain results", async () => {
  const source="const promise=Promise.resolve(undefined);promise.field=17;return [await promise?.field,await promise?.missing]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:[17,undefined]});
});

it("preserves awaited chain keys and skipped calls through replay", async () => {
  const source="const object={a:null};const value=object?.[await key()]?.b(await unreachable());await 0;return value";
  let keys=0,unreachable=0;
  const bindings={key(){keys++;return 'a'},unreachable(){unreachable++;throw Error('unreachable')}};
  const first=await run(source,{bindings});
  expect(first).toMatchObject({ok:true,returnValue:undefined});
  expect(await run(source,{bindings,snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:undefined});
  expect([keys,unreachable]).toEqual([1,0]);
});

import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../src/run.js";

// Published ECMA-262 edition 16, Proxy [[OwnPropertyKeys]]. The result
// list is consumed before the target's current invariants are inspected.
const targets = ["{}", "function C(){}", "class C{}", "[]", "new Uint8Array(2)",
  "new Number(1)", "new String('a')", "Object(Symbol('s'))", "Object(1n)"];

it.each(targets)("checks post-coercion ownKeys state for %s", async target => {
  for (const include of [false, true]) {
    const source = `"use strict";const log=[];const t=(${target});const key=Symbol('locked');
      const initial=Reflect.ownKeys(t);let r;
      r=Proxy.revocable(t,{ownKeys(){log.push('trap');return new Proxy({}, {
        get(_,k){if(k==='length'){log.push('length');return {valueOf(){
          log.push('coerce');Object.defineProperty(t,key,{value:9});r.revoke();
          return initial.length+${include ? 1 : 0};}};}
          log.push('index:'+k);return Number(k)<initial.length?initial[Number(k)]:key;}
      });}});
      try{const keys=Reflect.ownKeys(r.proxy);log.push('keys',keys.includes(key));}
      catch(e){log.push(e.name);}
      try{Reflect.ownKeys(r.proxy);}catch(e){log.push('revoked:'+e.name);}
      return [log,Object.getOwnPropertyDescriptor(t,key).configurable];`;
    const initial = runInNewContext(`"use strict";Reflect.ownKeys((${target})).length`) as number;
    const expected = [["trap", "length", "coerce",
      ...Array.from({ length: initial + Number(include) }, (_, index) => `index:${index}`),
      ...(include ? ["keys", true] : ["TypeError"]), "revoked:TypeError"], false];
    expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  }
});

it.each([false, true])("consumes symbol keys before duplicate checks, duplicate=%s", async duplicate => {
  const source = `const log=[];const a=Symbol('same'),b=${duplicate ? "a" : "Symbol('same')"};
    const target=new Proxy({}, {isExtensible(){log.push('extensible');return true},
      ownKeys(){log.push('targetKeys');return []}});
    const p=new Proxy(target,{ownKeys(){return {length:2,
      get 0(){log.push('0');return a},get 1(){log.push('1');return b}}}});
    try{log.push(Reflect.ownKeys(p).length)}catch(e){log.push(e.name)}return log;`;
  const expected = duplicate ? ["0", "1", "TypeError"] : ["0", "1", "extensible", "targetKeys", 2];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

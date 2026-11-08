import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

// ECMA-262 edition 16: 10.5, 6.2.6.5, 10.4.2.3, 10.2.2, 10.4.1.2.
// Literal oracles specify observable order; native execution is an extra control.
const cases = [
  {
    name: "get validates a descriptor mutated by its trap",
    source: `const log=[];const t={x:1};const p=new Proxy(t,{get(t,k){log.push('get');Object.defineProperty(t,k,{value:2,writable:false,configurable:false});return 1}});try{p.x;log.push('after')}catch(e){log.push(e.name)}return log`,
    expected: ["get", "TypeError"]
  },
  {
    name: "get permits SameValue after sibling mutation",
    source: `const log=[];const t={x:1,y:0};const p=new Proxy(t,{get(t,k){log.push('get');t.y++;Object.defineProperty(t,k,{value:1,writable:false,configurable:false});return 1}});log.push(p.x,t.y);return log`,
    expected: ["get", 1, 1]
  },
  {
    name: "ownKeys consumes all elements before duplicate validation",
    source: `const log=[];const p=new Proxy({},{ownKeys(){log.push('trap');return {get length(){log.push('length');return 3},get 0(){log.push('0');return 'x'},get 1(){log.push('1');return 'x'},get 2(){log.push('2');return 'y'}}}});try{Reflect.ownKeys(p)}catch(e){log.push(e.name)}return log`,
    expected: ["trap", "length", "0", "1", "2", "TypeError"]
  },
  {
    name: "ownKeys invalid element stops before later getter",
    source: `const log=[];const p=new Proxy({},{ownKeys(){return {length:2,get 0(){log.push('0');return 1},get 1(){log.push('1');return 'x'}}}});try{Reflect.ownKeys(p)}catch(e){log.push(e.name)}return log`,
    expected: ["0", "TypeError"]
  },
  {
    name: "ownKeys preserves arbitrary string and symbol order",
    source: `const s=Symbol('s');const p=new Proxy({},{ownKeys(){return ['b',s,'2','1']}});return Reflect.ownKeys(p).map(k=>k===s?'symbol':k)`,
    expected: ["b", "symbol", "2", "1"]
  },
  {
    name: "self revocation retains target for in-flight get",
    source: `const log=[];const r=Proxy.revocable({x:7},{get(t,k){log.push('get');r.revoke();return t[k]}});log.push(r.proxy.x);try{r.proxy.x}catch(e){log.push(e.name)}return log`,
    expected: ["get", 7, "TypeError"]
  },
  {
    name: "self revocation still validates frozen target",
    source: `const log=[];const r=Proxy.revocable(Object.freeze({x:7}),{get(){log.push('get');r.revoke();return 8}});try{r.proxy.x}catch(e){log.push(e.name)}return log`,
    expected: ["get", "TypeError"]
  },
  {
    name: "throwing trap precedes target descriptor lookup",
    source: `const log=[];const inner=new Proxy({},{getOwnPropertyDescriptor(){log.push('descriptor');return undefined}});const outer=new Proxy(inner,{get(){log.push('get');throw 19}});try{outer.x}catch(e){log.push(e)}return log`,
    expected: ["get", 19]
  },
  {
    name: "receiver forwards to inherited getter and setter",
    source: `const log=[];const t={get x(){log.push(this.tag);return 3},set x(v){log.push(this.tag,v)}};const p=new Proxy(t,{});const receiver={tag:'receiver'};log.push(Reflect.get(p,'x',receiver));log.push(Reflect.set(p,'x',4,receiver));return log`,
    expected: ["receiver", 3, "receiver", 4, true]
  },
  {
    name: "descriptor input reads occur in specified order",
    source: `const log=[];const d=new Proxy({enumerable:true,configurable:true,value:1,writable:true},{has(t,k){log.push('has:'+k);return Reflect.has(t,k)},get(t,k){log.push('get:'+k);return Reflect.get(t,k)}});Object.defineProperty({},'x',d);return log`,
    expected: ["has:enumerable", "get:enumerable", "has:configurable", "get:configurable", "has:value", "get:value", "has:writable", "get:writable", "has:get", "has:set"]
  },
  {
    name: "preventExtensions validates post-trap target state",
    source: `const log=[];const t={};const p=new Proxy(t,{preventExtensions(){log.push('trap');return true}});try{Object.preventExtensions(p)}catch(e){log.push(e.name)}log.push(Object.isExtensible(t));return log`,
    expected: ["trap", "TypeError", true]
  },
  {
    name: "ordinary prototype cycles reject without mutation",
    source: `const a={},b=Object.create(a);return [Reflect.setPrototypeOf(a,b),Object.getPrototypeOf(a)===Object.prototype,Object.getPrototypeOf(b)===a]`,
    expected: [false, true, true]
  },
  {
    name: "bound construction substitutes bound newTarget",
    source: `function C(x){this.x=x;this.same=new.target===C}const B=C.bind({ignored:true},4);const v=new B();return [v.x,v.same,v instanceof B,v instanceof C,Object.getPrototypeOf(v)===C.prototype]`,
    expected: [4, true, true, true, true]
  },
  {
    name: "Reflect.construct forwards explicit newTarget",
    source: `const log=[];function C(){log.push(new.target===P)}function D(){}const P=new Proxy(D,{get(t,k,r){log.push(k);return Reflect.get(t,k,r)}});const v=Reflect.construct(C,[],P);return [log,Object.getPrototypeOf(v)===D.prototype]`,
    expected: [["prototype", true], true]
  },
  {
    name: "custom hasInstance receives primitive and exact receiver",
    source: `const log=[];const C={ [Symbol.hasInstance](v){log.push(this===C,v);return 'truthy'}};return [3 instanceof C,log]`,
    expected: [true, [true, 3]]
  },
  {
    name: "species construction precedes indexed reads",
    source: `const log=[];const a=[1];Object.defineProperty(a,'0',{get(){log.push('index');return 1}});a.constructor={get [Symbol.species](){log.push('species');return class extends Array{constructor(n){log.push('construct',n);super(n)}}}};const b=a.map(x=>{log.push('callback');return x+1});return [log,b[0],b.length]`,
    expected: [["species", "construct", 1, "index", "callback"], 2, 1]
  }
];

it.each(cases)("qualifies $name", async ({ source, expected }) => {
  expect(new Function(source)()).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each(["({})", "function C(){}", "class C{}", "[]", "new Uint8Array(2)", "new Number(1)", "new String('a')", "Object(Symbol('s'))", "Object(1n)"])(
  "preserves frozen symbol invariants across repeated snapshots: %s", async expression => {
    const source = `const t=${expression};const s=Symbol('key');Object.defineProperty(t,s,{value:9,writable:false,configurable:false});const p=new Proxy(t,{get(t,k,r){return Reflect.get(t,k,r)}});await 0;const d=Object.getOwnPropertyDescriptor(p,s);return [p[s],d.value,d.writable,d.configurable,Reflect.ownKeys(p).includes(s),Object.getPrototypeOf(p)===Object.getPrototypeOf(t)]`;
    const expected = [9, 9, false, false, true, true];
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const wire = JSON.parse(await dump(pending));
      expect(await completed).toMatchObject({ ok: true, returnValue: expected });
      const first = await run(source, { snapshot: restore(wire, { source }) });
      expect(first).toMatchObject({ ok: true, returnValue: expected });
      const second = await run(source, { snapshot: restore(JSON.parse(await dump(first)), { source }) });
      expect(second).toMatchObject({ ok: true, returnValue: expected });
    } finally { await completed; }
  }
);

it("propagates a budget failure during ownKeys length coercion before indexed reads", async () => {
  const { Budget } = await import("./budget.js");
  const { createSandboxClosure } = await import("./values.js");
  const { createGuestProxy } = await import("./guest-proxy.js");
  const { sandboxOwnKeys } = await import("./guest-proxy-own-keys.js");
  const events: string[] = [];
  const budget = new Budget({ maxSteps: 50 });
  const length = { valueOf: createSandboxClosure({ guest: true, call: () => {
    events.push("valueOf");
    for (let i = 0; i < 100; i++) budget.visitNode();
    return 1;
  } }) };
  const list = { length, 0: "x" };
  const proxy = createGuestProxy({}, { ownKeys: createSandboxClosure({ guest: true, call: () => { events.push("trap"); return list; } }) });
  await expect(sandboxOwnKeys(proxy, budget, { stack: [], getProperty(value, key) {
    if (value === list) events.push(String(key));
    return Reflect.get(value as object, key);
  } })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  expect(events).toEqual(["trap", "length", "valueOf"]);
  expect([...budget.retainedValues()]).toEqual([]);
});

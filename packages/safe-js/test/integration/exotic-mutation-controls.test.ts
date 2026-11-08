import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../src/run.js";

// ECMA-262 edition 16 §10.5: validate the target state AFTER the trap.
// Fixed traces are the oracle; an isolated native realm is an independent control.
const cases = [
  {
    name: "set observes a newly frozen property",
    source: `const log=[];const t={x:1,y:0};const p=new Proxy(t,{set(t,k,v){log.push('set');t.y++;Object.defineProperty(t,k,{value:2,writable:false,configurable:false});return true}});try{Reflect.set(p,'x',3);log.push('after')}catch(e){log.push(e.name)}return [log,t.x,t.y]`,
    expected: [["set", "TypeError"], 2, 1]
  },
  {
    name: "set allows SameValue after freezing and sibling mutation",
    source: `const log=[];const t={x:1,y:0};const p=new Proxy(t,{set(t,k,v){log.push('set');t.y++;Object.defineProperty(t,k,{value:v,writable:false,configurable:false});return true}});log.push(Reflect.set(p,'x',3));return [log,t.x,t.y]`,
    expected: [["set", true], 3, 1]
  },
  {
    name: "delete rejects a surviving property on a newly nonextensible target",
    source: `const log=[];const t={x:1};const p=new Proxy(t,{deleteProperty(t){log.push('delete');Object.preventExtensions(t);return true}});try{Reflect.deleteProperty(p,'x');log.push('after')}catch(e){log.push(e.name)}return [log,t.x,Object.isExtensible(t)]`,
    expected: [["delete", "TypeError"], 1, false]
  },
  {
    name: "delete allows removal before preventing extensions",
    source: `const log=[];const t={x:1};const p=new Proxy(t,{deleteProperty(t,k){log.push('delete');delete t[k];Object.preventExtensions(t);return true}});log.push(Reflect.deleteProperty(p,'x'));return [log,Reflect.has(t,'x'),Object.isExtensible(t)]`,
    expected: [["delete", true], false, false]
  },
  {
    name: "has cannot hide a sibling frozen by its own trap",
    source: `const log=[];const t={x:1,y:2};const p=new Proxy(t,{has(t,k){log.push('has');Object.defineProperty(t,'y',{configurable:false});return false}});log.push('x' in p);try{log.push('y' in p)}catch(e){log.push(e.name)}return log`,
    expected: ["has", false, "has", "TypeError"]
  },
  {
    name: "ownKeys validates keys added by result getters",
    source: `const log=[];const t={};const p=new Proxy(t,{ownKeys(){log.push('keys');return {length:1,get 0(){log.push('0');Object.defineProperty(t,'y',{value:2});return 'x'}}}});try{Reflect.ownKeys(p);log.push('after')}catch(e){log.push(e.name)}return log`,
    expected: ["keys", "0", "TypeError"]
  },
  {
    name: "ownKeys permits a configurable sibling added by result getters",
    source: `const log=[];const t={};const p=new Proxy(t,{ownKeys(){log.push('keys');return {length:1,get 0(){log.push('0');t.y=2;return 'x'}}}});return [Reflect.ownKeys(p),log,t.y]`,
    expected: [["x"], ["keys", "0"], 2]
  },
  {
    name: "construct self revocation completes once and never rereads handler",
    source: `const log=[];const r=Proxy.revocable(function C(){},{construct(t,args,n){log.push(n===r.proxy,args[0]);r.revoke();return {x:7}}});log.push(new r.proxy(3).x);try{new r.proxy(4)}catch(e){log.push(e.name)}return log`,
    expected: [true, 3, 7, "TypeError"]
  },
  {
    name: "construct validates primitive result after self revocation",
    source: `const log=[];const r=Proxy.revocable(function C(){},{construct(){log.push('construct');r.revoke();return 7}});try{new r.proxy();log.push('after')}catch(e){log.push(e.name)}return log`,
    expected: ["construct", "TypeError"]
  },
  {
    name: "absent nonconfigurable accessor getter rejects a fabricated value",
    source: `const log=[];const t={};Object.defineProperty(t,'x',{get:undefined,set:undefined});const p=new Proxy(t,{get(){log.push('get');return 1},set(){log.push('set');return true}});try{p.x}catch(e){log.push(e.name)}try{Reflect.set(p,'x',1)}catch(e){log.push(e.name)}return log`,
    expected: ["get", "TypeError", "set", "TypeError"]
  }
];

it.each(cases)("qualifies mutation control: $name", async ({ source, expected }) => {
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

// Edition 16 §7.3.27–28 permits private elements on nonextensible objects.
// Reinitializing the same private name must still throw. The pinned newer
// nonextensible-applies-to-private fixture has a different contract.
it.each([
  { member: "#x=42", read: "o.#x" },
  { member: "#x(){return 42}", read: "o.#x()" },
  { member: "get #x(){return 42}", read: "o.#x" }
])("preserves edition-16 private element invariants: $member", async ({ member, read }) => {
  const source = `class Base{constructor(o){return o}}class C extends Base{${member};static read(o){return ${read}}}const o=Object.preventExtensions({});new C(o);let repeated;try{new C(o)}catch(e){repeated=e.name}return [C.read(o),Object.isExtensible(o),repeated]`;
  const expected = [42, false, "TypeError"];
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

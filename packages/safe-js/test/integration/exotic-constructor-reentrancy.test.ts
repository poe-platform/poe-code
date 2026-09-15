import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../src/run.js";

// Edition 16 §§10.2.2, 28.1.2, 10.4.1.2: fixed traces are the
// oracle. Native controls have a separate realm with no injected authority.
const cases = [
  {
    name: "argument coercion revokes newTarget before prototype lookup",
    source: `const log=[];function C(){log.push('body')}const r=Proxy.revocable(function(){},{});const args={get length(){log.push('length');r.revoke();return 1},get 0(){log.push('0');return 4}};try{Reflect.construct(C,args,r.proxy)}catch(e){log.push(e.name)}return log`,
    expected: ["length", "0", "TypeError"]
  },
  {
    name: "argument getter mutates the constructor prototype before allocation",
    source: `const log=[];const proto={tag:7};function C(v){log.push('body',v,new.target===N)}function N(){}const args={get length(){log.push('length');return 1},get 0(){log.push('0');N.prototype=proto;return 4}};const o=Reflect.construct(C,args,N);return [log,Object.getPrototypeOf(o)===proto]`,
    expected: [["length", "0", "body", 4, true], true]
  },
  {
    name: "invalid newTarget rejects before reading the argument list",
    source: `const log=[];function C(){log.push('body')}const args={get length(){log.push('length');throw 41}};try{Reflect.construct(C,args,()=>{})}catch(e){log.push(e.name)}return log`,
    expected: ["TypeError"]
  },
  {
    name: "throwing argument getter precedes construct trap lookup",
    source: `const log=[];const C=new Proxy(function(){},{get construct(){log.push('trap');return ()=>({})}});const args={get length(){log.push('length');return 2},get 0(){log.push('0');throw 41},get 1(){log.push('1');return 3}};try{Reflect.construct(C,args)}catch(e){log.push(e)}return log`,
    expected: ["length", "0", 41]
  },
  {
    name: "bound constructor forwards a distinct newTarget through both layers",
    source: `const log=[];function C(a,b,c){log.push(a,b,c,new.target===N)}const B=C.bind(null,1).bind(null,2);function N(){}const o=Reflect.construct(B,[3],N);return [log,Object.getPrototypeOf(o)===N.prototype]`,
    expected: [[1, 2, 3, true], true]
  },
  {
    name: "hasInstance lookup self revocation retains this and the callable",
    source: `const log=[];let r;r=Proxy.revocable(function(){},{get(t,k){log.push(k===Symbol.hasInstance);r.revoke();return function(v){log.push(this===r.proxy,v);return true}}});log.push(7 instanceof r.proxy);try{8 instanceof r.proxy}catch(e){log.push(e.name)}return log`,
    expected: [true, true, 7, true, "TypeError"]
  },
  {
    name: "derived object return avoids revoked newTarget prototype lookup",
    source: `const log=[];class C extends null{constructor(){log.push('body');return {x:7}}}const r=Proxy.revocable(function(){},{});r.revoke();const o=Reflect.construct(C,[],r.proxy);return [log,o.x,Object.getPrototypeOf(o)===Object.prototype]`,
    expected: [["body"], 7, true]
  }
];

it.each(cases)("qualifies constructor reentrancy: $name", async ({ source, expected }) => {
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

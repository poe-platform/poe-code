import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([
  ['map', '(x)=>x*2'], ['filter', '(x)=>true'], ['some', '(x)=>x===1'],
  ['every', '(x)=>x>0'], ['forEach', '(x)=>events.push("callback:"+x)'],
  ['reduce', '(sum,x)=>sum+x'], ['reduceRight', '(sum,x)=>sum+x'],
  ['indexOf', '1'], ['lastIndexOf', '3'], ['slice', '0'], ['flat', ''],
  ['reverse', ''], ['copyWithin', '0,1'], ['sort', ''], ['splice', '0,2'],
  ['shift', ''], ['unshift', '9'], ['pop', ''], ['push', '9'], ['fill', '9']
].flatMap(([method, args]) => [false, true].map(direct => ({ method, args, direct }))))(
  "dispatches $method through Proxy traps (direct=$direct)", async ({ method, args, direct }) => {
  const source = `const events=[];const target={0:3,2:1,length:3};
    ${direct ? 'Object.setPrototypeOf(target,Array.prototype);' : ''}
    const p=wrap(target,{
      get(t,k,r){events.push("get:"+String(k));return Reflect.get(t,k,r)},
      has(t,k){events.push("has:"+k);return Reflect.has(t,k)},
      set(t,k,v){events.push("set:"+k);return Reflect.set(t,k,v)},
      deleteProperty(t,k){events.push("delete:"+k);return Reflect.deleteProperty(t,k)}
    });
    const result=${direct ? `p.${method}(${args})` : `Array.prototype.${method}.call(p,${args})`};
    return [result===p?"receiver":result,target,events]`;
  const expected = new Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  'const target={0:1,length:1};const p=wrap(target,{has(){throw 31}});try{Array.prototype.map.call(p,x=>x)}catch(e){return [e,target]}',
  'const target={0:1,length:1};const p=wrap(target,{deleteProperty(){return false}});try{Array.prototype.pop.call(p)}catch(e){return [e.name,target]}',
  'const target={0:1,length:1};const p=wrap(target,{deleteProperty(){throw 43}});try{Array.prototype.pop.call(p)}catch(e){return [e,target]}',
  'const target={0:1,length:1};const p=wrap(target,{set(){return false}});try{Array.prototype.push.call(p,2)}catch(e){return [e.name,target]}',
  'const target={0:1,length:1};Object.defineProperty(target,"0",{configurable:false});const p=wrap(target,{has(){return false}});try{Array.prototype.map.call(p,x=>x)}catch(e){return [e.name,target]}'
])("propagates array Proxy failures: %s", async source => {
  const expected = new Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

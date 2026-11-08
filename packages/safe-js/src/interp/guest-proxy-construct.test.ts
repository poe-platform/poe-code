import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject } from "./values.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { constructGuestProxy } from "./guest-proxy-construct.js";

it.each([
  'function C(x){this.x=x;this.target=new.target}const P=wrap(C,{});const value=new P(3);return [value.x,value.target===P,value instanceof C]',
  'function C(){}const handler={construct(t,args,n){return {target:t===C,args,newTarget:n===P,receiver:this===handler}}};const P=wrap(C,handler);return new P(1,2)',
  'function C(){this.target=new.target}function N(){}const P=wrap(C,{});const value=Reflect.construct(P,[],N);return [value.target===N,Object.getPrototypeOf(value)===N.prototype]',
  'function C(){this.target=new.target}const P=wrap(wrap(C,{}),{});const value=new P();return [value.target===P,value instanceof C]',
  'const P=wrap(function(){},{construct(){return 1}});try{return new P()}catch(e){return e.name}',
  'const P=wrap(function(){},{construct(){return null}});try{return new P()}catch(e){return e.name}',
  'const P=wrap(function(){},{get construct(){throw 37}});try{return new P()}catch(e){return e}',
  'const P=wrap(function(){},{construct:1});try{return new P()}catch(e){return e.name}',
  'const P=wrap(()=>1,{construct(){return {}}});try{return new P()}catch(e){return e.name}',
  'class C{constructor(x){this.x=x}}const P=wrap(C,{});return new P(3).x',
  'function C(x){this.x=x}const P=wrap(C,{});const B=P.bind(null,3);return new B().x',
  'const P=wrap(function(){},{construct:wrap((t,args)=>({x:args[0]}),{})});return new P(3)',
  'function C(x){this.x=x}const P=wrap(C,{construct:null});return new P(3).x',
  'function C(){}const proto={};const events=[];const P=wrap(C,{get(t,k,r){events.push(k);if(k==="prototype")return proto;return Reflect.get(t,k,r)}});const value=new P();return [Object.getPrototypeOf(value)===proto,events]',
  'function C(){}const P=wrap(C,{get(t,k,r){if(k==="prototype")throw 43;return Reflect.get(t,k,r)}});try{return new P()}catch(e){return e}',
  'class C{constructor(x){this.x=x;this.target=new.target}}const P=wrap(C,{});class D extends P{}const value=new D(7);return [value.x,value.target===D,value instanceof D,value instanceof C]'
])("constructs internal Proxies: %s", async source => {
  const expected = new Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

const directContext: SandboxCallContext = {
  stack: [], thisValue: undefined,
  getProperty: (value, key) => (value as SandboxObject)[key]
};

it("preserves an explicit newTarget in standalone builtin construction", async () => {
  const budget = new Budget();
  const target = createSandboxClosure({ call: () => undefined, construct: (_, context) => context?.newTarget });
  const proxy = createGuestProxy(target, {}) as SandboxClosure;
  const newTarget = createSandboxClosure({ call: () => undefined, construct: () => ({}) });
  expect(await invokeBuiltinClosure(proxy, [], budget, directContext, undefined, true, newTarget)).toBe(newTarget);
  expect([...budget.retainedValues()]).toEqual([]);
});

it("retains newTarget and arguments across failing construct traps", async () => {
  const budget = new Budget(), entry = {}, args = [entry];
  const target = createSandboxClosure({ call: () => undefined, construct: () => ({}) });
  const newTarget = createSandboxClosure({ call: () => undefined, construct: () => ({}) });
  const handler = { construct: createSandboxClosure({ call: ([actualTarget, list, actualNewTarget], context) => {
    expect(context?.thisValue).toBe(handler);
    expect(actualTarget).toBe(target);
    expect(actualNewTarget).toBe(newTarget);
    expect(list).toEqual(args);
    expect(list).not.toBe(args);
    expect([...budget.retainedValues()]).toEqual(expect.arrayContaining([entry, newTarget, list]));
    throw 43;
  } }) };
  const proxy = createGuestProxy(target, handler);
  await expect(constructGuestProxy(proxy, args, budget, directContext, newTarget)).rejects.toBe(43);
  expect([...budget.retainedValues()]).toEqual([]);
});

it("preserves constructible identity but rejects revoked construction", async () => {
  const target = createSandboxClosure({ call: () => undefined, construct: () => ({}) });
  const proxy = createGuestProxy(target, {}) as SandboxClosure;
  revokeGuestProxy(proxy);
  expect(proxy.construct).toBeDefined();
  await expect(constructGuestProxy(proxy, [], new Budget(), directContext, proxy)).rejects.toThrow(TypeError);
});

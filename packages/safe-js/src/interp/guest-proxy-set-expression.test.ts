import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([
  { name: "assignment result and trap receiver", source: 'const calls=[];const handler={set(t,k,v,r){calls.push([k,v,r===p,this===handler]);return true}};const p=wrap({},handler);return [p.x=7,calls]' },
  { name: "strict refusal", source: 'const p=wrap({},{set(){return false}});try{p.x=7;return false}catch(e){return e.name}' },
  { name: "sloppy refusal", source: 'const p=wrap({},{set(){return false}});return Function("p","return p.x=7")(p)' },
  { name: "nested fallback", source: 'const target={};const p=wrap(wrap(target,{}),{});p.x=8;return target.x' },
  { name: "inherited trap", source: 'const calls=[];const p=wrap({},{set(t,k,v,r){calls.push([k,v,r===child]);return true}});const child=Object.create(p);child.x=9;return [calls,Object.hasOwn(child,"x")]' },
  { name: "compound assignment", source: 'const target={x:2};const events=[];const p=wrap(target,{set(t,k,v){events.push(v);return Reflect.set(t,k,v)}});return [p.x+=3,target.x,events]' },
  { name: "postfix update", source: 'const target={x:2};const events=[];const p=wrap(target,{set(t,k,v){events.push(v);return Reflect.set(t,k,v)}});return [p.x++,target.x,events]' },
  { name: "destructuring assignment", source: 'const events=[];const p=wrap({},{set(t,k,v){events.push([k,v]);return true}});({x:p.y}={x:10});return events' },
  { name: "super through proxy", source: 'const events=[];const p=wrap({},{set(t,k,v,r){events.push([k,v,r===child]);return true}});const child={write(){super.x=11}};Object.setPrototypeOf(child,p);child.write();return events' },
  { name: "super with proxy receiver", source: 'const events=[];const base={};const child={write(){super.x=12}};Object.setPrototypeOf(child,base);const p=wrap(child,{set(){throw Error("must not call set")},defineProperty(t,k,d){events.push([k,d.value]);return true}});p.write();return events' },
  { name: "setter assigns through receiver proxy", source: 'const target={set x(v){this.y=v}};const p=wrap(target,{});p.x=13;return target.y' },
  { name: "with assignment", source: 'const target={x:1};const events=[];const p=wrap(target,{set(t,k,v){events.push(v);return Reflect.set(t,k,v)}});return [Function("p","with(p){x=14;return x}")(p),events]' },
  { name: "strict closure with binding", source: 'const target={x:1};const p=wrap(target,{});return Function("p",\'with(p){return (function(){"use strict";x=15;return x})()}\')(p)' }
])("matches native Proxy assignment expressions: $name", async ({ source }) => {
  const expected = Function("wrap", '"use strict";' + source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

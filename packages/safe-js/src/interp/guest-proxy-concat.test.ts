import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([
  'const p=wrap([1,,3],{});const r=p.concat(4);return [r.length,Object.keys(r),r[0],r[1],r[2],r[3]]',
  'const p=wrap([1,,3],{});const r=[0].concat(p,4);return [r.length,Object.keys(r),r[0],r[1],r[2],r[3],r[4]]',
  'const p=wrap(wrap([1,2],{}),{});return [].concat(p)',
  'const p=wrap([1,2],{get(t,k,r){if(k===Symbol.isConcatSpreadable)return false;return Reflect.get(t,k,r)}});const r=[0].concat(p);return [r.length,r[1]===p]',
  'const p=wrap({0:1,length:1},{});const r=[].concat(p);return [r.length,r[0]===p]',
  'const p=wrap({0:1,length:1},{get(t,k,r){if(k===Symbol.isConcatSpreadable)return true;return Reflect.get(t,k,r)}});return [].concat(p)',
  'const events=[];const p=wrap([1,,3],{get(t,k,r){events.push("get:"+String(k));return Reflect.get(t,k,r)},has(t,k){events.push("has:"+k);return Reflect.has(t,k)}});const r=[].concat(p);return [r.length,r[0],r[2],events]',
  'const target=[1,2];const p=wrap(target,{get(t,k,r){if(k===Symbol.isConcatSpreadable){target.push(3);return undefined}return Reflect.get(t,k,r)}});return [].concat(p)',
  'const p=wrap([1],{get(t,k,r){if(k===Symbol.isConcatSpreadable)throw 43;return Reflect.get(t,k,r)}});try{return [].concat(p)}catch(e){return e}',
  'class Items extends Array{}const p=wrap(new Items(1,2),{});const r=p.concat(3);return [r instanceof Items,r.length,r[0],r[1],r[2]]'
])("spreads wrapped arrays in concat: %s", async source => {
  const expected = new Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it.each(['undefined', 'false'])("checks array identity only after the spreadability override: %s", async flag => {
  const source = `const p=wrap([1],{get(t,k,r){if(k===Symbol.isConcatSpreadable){revoke(p);return ${flag}}return Reflect.get(t,k,r)}});
    try{const result=[].concat(p);return [result.length,result[0]===p]}catch(e){return e.name}`;
  const revokers = new WeakMap<object, () => void>();
  const expected = new Function("wrap", "revoke", source)((target: object, handler: ProxyHandler<object>) => {
    const { proxy, revoke } = Proxy.revocable(target, handler);
    revokers.set(proxy, revoke);
    return proxy;
  }, (proxy: object) => revokers.get(proxy)!());
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  const revoke = createSandboxClosure({ guest: true, call: ([proxy]) => revokeGuestProxy(proxy as object) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap, revoke }
  })).toMatchObject({ ok: true, returnValue: expected });
});

import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([
  'const p=wrap([1,,3],{});return [p].flat()',
  'const p=wrap([1,,3],{});return [0,1].flatMap(()=>p)',
  'const inner=wrap([1],{});const outer=wrap([inner],{});return [outer].flat(2)',
  'const inner=wrap([1],{});const outer=wrap([inner],{});const r=[outer].flat();return [r.length,r[0]===inner]',
  'const p=wrap([1],{});const r=[p].flat(0);return [r.length,r[0]===p]',
  'const p=wrap({0:1,length:1,[Symbol.isConcatSpreadable]:true},{});const r=[p].flat();return [r.length,r[0]===p]',
  'const p=wrap([1],{get(t,k,r){if(k===Symbol.isConcatSpreadable)throw 37;return Reflect.get(t,k,r)}});return [p].flat()',
  ...['[p].flat()', '[0].flatMap(()=>p)'].map(expression => `const events=[];const target=[1,,3];
    const p=wrap(target,{get(t,k,r){events.push("get:"+String(k));if(k==="0")target.push(4);return Reflect.get(t,k,r)},
      has(t,k){events.push("has:"+k);return Reflect.has(t,k)}});const result=${expression};return [result,events]`),
  'const p=wrap([1],{get(t,k,r){if(k==="length")throw 43;return Reflect.get(t,k,r)}});try{return [p].flat()}catch(e){return e}',
  'const p=wrap([1],{has(){throw 47}});try{return [0].flatMap(()=>p)}catch(e){return e}',
  'const p=wrap(wrap([1,2],{}),{});return [p].flat(Infinity)'
])("flattens wrapped arrays: %s", async source => {
  const expected = new Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it.each(['[proxy].flat()', '[0].flatMap(()=>proxy)'])("retains nested receivers across failing traps: %s", async expression => {
  const budget = new Budget();
  const proxy = createGuestProxy([7], { get: createSandboxClosure({ guest: true, call: ([, key]) => {
    expect([...budget.retainedValues()]).toContain(proxy);
    if (key === 'length') return 1;
    throw 43;
  } }) });
  const parsed = parseModule(`try{return ${expression}}catch(e){return e}`);
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), proxy }
  })).toMatchObject({ ok: true, returnValue: 43 });
  expect([...budget.retainedValues()]).not.toContain(proxy);
});

it.each([0, 1])("checks revoked nested arrays only at positive depth: %s", async depth => {
  const proxy = createGuestProxy([], {});
  revokeGuestProxy(proxy);
  const budget = new Budget(), parsed = parseModule(`try{const result=[proxy].flat(${depth});return result[0]===proxy}catch(e){return e.name}`);
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), proxy }
  })).toMatchObject({ ok: true, returnValue: depth === 0 ? true : 'TypeError' });
});

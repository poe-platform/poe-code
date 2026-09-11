import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

for (const api of ["Object", "Reflect"]) {
  it.each([
    { name: "new configurable", setup: "", descriptor: "{value:1,configurable:true}", result: "true" },
    { name: "omitted configurable", setup: "", descriptor: "{value:1}", result: "true" },
    { name: "new nonconfigurable lie", setup: "", descriptor: "{value:1,configurable:false}", result: "true" },
    { name: "nonextensible new property", setup: "Object.preventExtensions(target);", descriptor: "{value:1}", result: "true" },
    { name: "refusal", setup: "", descriptor: "{value:1}", result: "false" },
    { name: "truthy result", setup: "", descriptor: "{value:1}", result: '"yes"' },
    { name: "matching frozen", setup: 'Object.defineProperty(target,"x",{value:1});', descriptor: "{value:1}", result: "true" },
    { name: "changed frozen", setup: 'Object.defineProperty(target,"x",{value:1});', descriptor: "{value:2}", result: "true" },
    { name: "newly nonwritable lie", setup: 'Object.defineProperty(target,"x",{value:1,writable:true});', descriptor: "{writable:false}", result: "true" },
    { name: "newly nonconfigurable lie", setup: 'Object.defineProperty(target,"x",{value:1,configurable:true});', descriptor: "{configurable:false}", result: "true" },
    { name: "unchanged generic descriptor", setup: 'Object.defineProperty(target,"x",{value:1});Object.preventExtensions(target);', descriptor: "{}", result: "true" }
  ])(`${api} matches native Proxy definition: $name`, async ({ setup, descriptor, result }) => {
    const source = `const target={};${setup}const calls=[];
      const handler={defineProperty(t,k,d){calls.push([t===target,k,d,this===handler]);return ${result}}};
      const p=wrap(target,handler);let outcome;
      try{const value=${api}.defineProperty(p,"x",${descriptor});outcome=value===p?"proxy":value}catch(e){outcome=e.name}
      return [outcome,calls,Object.getOwnPropertyDescriptor(target,"x")]`;
    const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
    const budget = new Budget(), parsed = parseModule(source);
    const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
    })).toMatchObject({ ok: true, returnValue: expected });
  });
}

it.each([
  { name: "nested fallback", source: 'const target={};const p=wrap(wrap(target,{}),{});Object.defineProperty(p,"x",{value:7});return target.x' },
  { name: "actual frozen definition", source: 'const target={};const p=wrap(target,{defineProperty(t,k,d){return Reflect.defineProperty(t,k,d)}});Object.defineProperty(p,"x",{value:8,configurable:false});return Object.getOwnPropertyDescriptor(target,"x")' },
  { name: "accessor identity and sparse descriptor", source: 'const getter=()=>9;const target={};let seen;const p=wrap(target,{defineProperty(t,k,d){seen=[Object.keys(d),d.get===getter];return true}});return [Reflect.defineProperty(p,"x",{get:getter}),seen]' },
  { name: "array length fallback", source: 'const target=[1,2,3];const p=wrap(target,{});Object.defineProperty(p,"length",{value:1});return target' },
  { name: "trap mutation does not change input descriptor", source: 'const target={};let called=false;const p=wrap(target,{defineProperty(t,k,d){called=true;d.configurable=false;return true}});return [Reflect.defineProperty(p,"x",{value:1}),called]' },
  { name: "refusal skips target invariants", source: 'const target=wrap({},{getOwnPropertyDescriptor(){throw Error("unexpected")}});const p=wrap(target,{defineProperty(){return false}});return Reflect.defineProperty(p,"x",{value:1})' },
  { name: "descriptor field order", source: 'let keys;const p=wrap({},{defineProperty(t,k,d){keys=Object.keys(d);return true}});Reflect.defineProperty(p,"x",{enumerable:true,configurable:true,writable:true,value:1});return keys' },
  { name: "symbol fallback", source: 'const key=Symbol("x");const target={};Object.defineProperty(wrap(target,{}),key,{value:12});return target[key]' }
])("matches native Proxy definition details: $name", async ({ source }) => {
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

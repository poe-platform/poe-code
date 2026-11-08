import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([
  { name: "enumeration and conversion finish before definitions", source: `const events=[];const s=Symbol("s");const label=k=>k===s?"symbol":k;
    const descriptors=wrap({}, {ownKeys(){events.push("keys");return ["b",s,"hidden","missing","a"]},
      getOwnPropertyDescriptor(t,k){events.push("desc:"+label(k));if(k==="missing")return;return {enumerable:k!=="hidden",configurable:true}},
      get(t,k){events.push("get:"+label(k));return {get value(){events.push("value:"+label(k));return label(k)},configurable:true}}});
    const out={};const target=wrap(out,{defineProperty(t,k,d){events.push("define:"+label(k));return Reflect.defineProperty(t,k,d)}});
    return [Object.defineProperties(target,descriptors)===target,out.b,out[s],out.a,events]` },
  { name: "invalid later descriptor prevents all definitions", source: `const out={};const descriptors=wrap({a:{value:1},b:17},{});
    try{Object.defineProperties(out,descriptors)}catch(e){return [e.name,Reflect.ownKeys(out)]}` },
  { name: "Object.create uses Proxy descriptors", source: 'const proto={p:1};const out=Object.create(proto,wrap({a:{value:2}},{}));return [out.a,Object.getPrototypeOf(out)===proto]' },
  { name: "descriptor read deletes later key", source: 'const data={a:{value:1},b:{value:2}};const descriptors=wrap(data,{get(t,k){if(k==="a")delete t.b;return t[k]}});return Object.getOwnPropertyDescriptors(Object.defineProperties({},descriptors))' },
  { name: "hidden descriptor skipped", source: 'const descriptors=wrap({a:{value:1}},{getOwnPropertyDescriptor(){return undefined}});return Object.defineProperties({},descriptors)' },
  { name: "failed definition preserves earlier definitions", source: `const events=[];const descriptors=wrap({a:{value:1},b:{value:2},c:{value:3}},
    {get(t,k){events.push("get:"+k);return t[k]}});const out={};const target=wrap(out,{defineProperty(t,k,d){events.push("define:"+k);return k!=="b"&&Reflect.defineProperty(t,k,d)}});
    try{Object.defineProperties(target,descriptors)}catch(e){return [e.name,Object.getOwnPropertyNames(out),events]}` },
  { name: "ordinary later property becomes enumerable", source: 'const descriptors={get a(){Object.defineProperty(descriptors,"b",{enumerable:true});return {value:1}}};Object.defineProperty(descriptors,"b",{value:{value:2},configurable:true});return Object.getOwnPropertyNames(Object.defineProperties({},descriptors))' },
  { name: "ordinary later symbol becomes enumerable", source: 'const s=Symbol("b");const descriptors={get a(){Object.defineProperty(descriptors,s,{enumerable:true});return {value:1}}};Object.defineProperty(descriptors,s,{value:{value:2},configurable:true});const out=Object.defineProperties({},descriptors);return [out.a,out[s]]' }
])("Object.defineProperties descriptor maps: $name", async ({ source }) => {
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it.each(['Object.defineProperties({},descriptors)', 'Object.create(null,descriptors)'])("rejects a revoked descriptor map: %s", async operation => {
  const budget = new Budget(), descriptors = createGuestProxy({}, {});
  revokeGuestProxy(descriptors);
  const parsed = parseModule(`try{${operation};return false}catch(e){return e instanceof TypeError}`);
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), descriptors }
  })).toMatchObject({ ok: true, returnValue: true });
});

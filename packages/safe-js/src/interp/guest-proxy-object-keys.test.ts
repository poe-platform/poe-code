import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

for (const method of ["getOwnPropertyNames", "getOwnPropertySymbols"]) {
  it.each([
    { name: "filters keys without descriptor or value reads", body: `const s=Symbol("s");const events=[];
      const p=wrap({}, {ownKeys(){events.push("keys");return ["b",s,"2","a"]},
        getOwnPropertyDescriptor(){throw 17},get(){throw 18}});
      return [Object.METHOD(p).map(k=>k===s?"symbol":k),events]` },
    { name: "forwards through nested proxies", body: `const s=Symbol("s");const p=wrap(wrap({a:1,[s]:2},{}),{});
      return Object.METHOD(p).map(k=>k===s?"symbol":k)` },
    { name: "checks all keys before filtering", body: `const s=Symbol("s");
      try{return Object.METHOD(wrap({}, {ownKeys(){return [s,s,"a","a"]}}))}catch(e){return e.name}` }
  ])(`${method}: $name`, async ({ body }) => {
    const source = body.replaceAll("METHOD", method);
    const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
    const budget = new Budget(), parsed = parseModule(source);
    const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
    })).toMatchObject({ ok: true, returnValue: expected });
  });
}

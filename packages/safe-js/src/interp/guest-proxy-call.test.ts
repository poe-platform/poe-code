import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject } from "./values.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { callGuestProxy } from "./guest-proxy-call.js";

it.each([
  'const p=wrap((a,b)=>a+b,{});return [typeof p,p(2,3)]',
  'const p=wrap(function(a){return this.x+a},{});return p.call({x:2},3)',
  'const f=(a)=>a+1;const handler={apply(t,r,args){return [this===handler,t===f,r.x,args]}};const p=wrap(f,handler);return p.call({x:7},2,3)',
  'const p=wrap(x=>x,{apply(t,r,args){args.push(4);return args}});return p(1,2)',
  'const p=wrap(wrap(x=>x+1,{}),{});return p(4)',
  'const p=wrap(x=>x,{get apply(){throw 37}});try{return p(1)}catch(e){return e}',
  'const p=wrap(x=>x,{apply:1});try{return p(1)}catch(e){return e.name}',
  'const p=wrap(x=>x+1,{apply:null});return p(1)',
  'const p=wrap(x=>x*2,{});return [1,2].map(p)',
  'const p=wrap(function(a,b){return this.x+a+b},{});return p.bind({x:1},2)(3)',
  'const p=wrap(x=>x,{apply:wrap((t,r,args)=>args[0]+3,{})});return p(2)',
  'const p=wrap(function(a,b){return a+b},{});return Reflect.apply(p,null,[2,3])',
  'const p=wrap({}, {apply(){return 7}});try{return p()}catch(e){return [typeof p,e.name]}'
])("calls internal Proxies: %s", async source => {
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

it("dispatches callable proxies in the standalone builtin invocation path", async () => {
  const budget = new Budget();
  const proxy = createGuestProxy(createSandboxClosure({ call: ([value]) => value }), {});
  expect(await invokeBuiltinClosure(proxy as SandboxClosure, [7], budget, directContext, undefined)).toBe(7);
  expect([...budget.retainedValues()]).toEqual([]);
});

it("keeps callable identity after revocation and rejects invocation", async () => {
  const proxy = createGuestProxy(createSandboxClosure({ call: () => 7 }), {});
  revokeGuestProxy(proxy);
  expect(isSandboxClosure(proxy)).toBe(true);
  await expect(callGuestProxy(proxy, [], new Budget(), directContext, undefined)).rejects.toThrow(TypeError);
});

it("bounds nested call forwarding and releases retained arguments", async () => {
  const budget = new Budget({ maxSteps: 20 });
  let proxy: SandboxObject | SandboxClosure = createSandboxClosure({ call: () => 7 });
  for (let index = 0; index < 30; index++) proxy = createGuestProxy(proxy, {});
  await expect(callGuestProxy(proxy, [{}], budget, directContext, {}))
    .rejects.toMatchObject({ code: 'budgetExceeded', budget: 'steps' });
  expect([...budget.retainedValues()]).toEqual([]);
});

it("retains arguments and receiver during apply and allocates a fresh argument list", async () => {
  const budget = new Budget(), receiver = {}, entry = {}, args = [entry];
  const target = createSandboxClosure({ call: () => 0 });
  const handler = { apply: createSandboxClosure({ call: ([actualTarget, actualReceiver, list], context) => {
    expect(context?.thisValue).toBe(handler);
    expect(actualTarget).toBe(target);
    expect(actualReceiver).toBe(receiver);
    expect(list).toEqual(args);
    expect(list).not.toBe(args);
    expect([...budget.retainedValues()]).toEqual(expect.arrayContaining([entry, receiver, list]));
    throw 43;
  } }) };
  const proxy = createGuestProxy(target, handler);
  await expect(callGuestProxy(proxy, args, budget, directContext, receiver)).rejects.toBe(43);
  expect([...budget.retainedValues()]).toEqual([]);
});

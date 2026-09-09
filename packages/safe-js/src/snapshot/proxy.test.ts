import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { createGuestProxy, createGuestProxyRevoker, guestProxyStates } from "../interp/guest-proxy.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { sandboxGetProperty } from "../interp/guest-proxy-get.js";
import type { SandboxCallContext, SandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore as restoreGraph } from "./restore.js";

it.each([
  'const proto=new Proxy({then(resolve){resolve(this.x)}},{});const p=Object.create(proto);p.x=7;await 0;return await Promise.resolve(p)',
  'const p=new Proxy({then(resolve){resolve(3)}},{});await 0;return await Promise.resolve(p)',
  'const f=new Proxy(x=>x+1,{});await 0;return await Promise.resolve(1).then(f)',
  'const P=new Proxy(Promise,{});await 0;return await P.all([1,2])',
  'const then=new Proxy(function(resolve){resolve(3)},{});const value={then};await 0;return await Promise.resolve(value)',
  'const target={x:2};const p=new Proxy(target,{});await 0;p.x++;return [p.x,target.x]',
  'const target={x:2};const handler={get(t,k,r){return k==="self"?r:Reflect.get(t,k,r)*2}};const p=new Proxy(target,handler);target.back=p;await 0;return [p.x,p.self===p,target.back===p]',
  'function C(x){this.x=x}const P=new Proxy(C,{});await 0;const v=new P(3);return [v.x,v instanceof P,v instanceof C]',
  'const p=new Proxy(x=>x+1,{apply(t,r,args){return Reflect.apply(t,r,args)*2}});await 0;return p(3)',
  'const r=Proxy.revocable({x:2},{});await 0;const value=r.proxy.x;r.revoke();r.revoke();try{return r.proxy.x}catch(e){return [value,e.name]}',
  'const r=Proxy.revocable(function(){},{});r.revoke();await 0;try{new r.proxy()}catch(e){return [typeof r.proxy,e.name]}',
  'const r=Proxy.revocable({x:2},{});const revoke=r.revoke;revoke.extra={revoke};const p=r.proxy;await 0;revoke();try{return p.x}catch(e){return [revoke.extra.revoke===revoke,e.name]}',
  'const p=new Proxy(new Proxy([1,,3],{}),{});await 0;return [Array.isArray(p),p.map(x=>x*2),[p].flat()]',
  'const p=new Proxy(x=>x+1,{});const bound=p.bind(null,3);await 0;return bound()',
  'const r=Proxy.revocable({},{});r.revoke();await 0;return [r.revoke(),r.revoke()]',
  'const events=[];const target={get x(){events.push("get");return 2}};const p=new Proxy(target,{get(t,k,r){events.push("trap");return Reflect.get(t,k,r)}});await 0;return [p.x,events]',
  'class Base{constructor(){return new Proxy({},{});}}class C extends Base{#x=3;read(){return this.#x}}const value=new C();await 0;return C.prototype.read.call(value)',
  'const p=new Proxy({a:1,b:2},{});function* g(){for(const k in p)yield k}const iterator=g();iterator.next();await 0;return [iterator.next().value,iterator.next().done]'
])("restores Proxy checkpoints: %s", async source => {
  const expected: unknown = await runInNewContext(`(async function(){${source}})()`);
  const pending = run(source), completed = pending.catch(error => error);
  try {
    const wire = JSON.parse(await dump(pending));
    expect(wire.pendingAwaits).toHaveLength(1);
    expect(Object.values(wire.heap ?? {}).some(node => (node as { kind?: string }).kind === 'guest-proxy')).toBe(true);
    expect(await completed).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: restore(wire, { source }) }))
      .toMatchObject({ ok: true, returnValue: expected });
  } finally { await completed; }
});

it.each(['callable', 'constructible', 'primitive', 'mixed-revoked', 'target-cycle', 'internal-target', 'symbol-handler', 'extra'])(
  "rejects malformed Proxy graph state: %s", corruption => {
    const source = 'return 0', proxy = createGuestProxy({}, {});
    const wire = JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: 'external', bindings: { proxy } }], callStack: [], pendingPromises: [], moduleBindings: {} })));
    const [id, node] = Object.entries(wire.heap).find(([, value]) => (value as {kind:string}).kind === 'guest-proxy')! as [string, Record<string, unknown>];
    if (corruption === 'callable') node.callable = true;
    if (corruption === 'constructible') node.constructible = true;
    if (corruption === 'primitive') node.target = 7;
    if (corruption === 'mixed-revoked') node.target = null;
    if (corruption === 'target-cycle') node.target = {kind:'ref',id:Number(id)};
    if (corruption === 'internal-target') {
      wire.heap['999999'] = {kind:'guest-source',functionKind:'normal',parameters:'',body:''};
      node.target = {kind:'ref',id:999999};
    }
    if (corruption === 'symbol-handler') {
      wire.heap['999999'] = {kind:'symbol',description:'handler'};
      node.handler = {kind:'ref',id:999999};
    }
    if (corruption === 'extra') node.extra = {};
    expect(() => restoreGraph(wire, { source })).toThrow();
  }
);

it("drops revoked private edges from a revoker-only graph", async () => {
  const source = 'return 0', proxy = createGuestProxy({secret:'proxy-only-secret'}, {});
  const revoke = createGuestProxyRevoker(proxy);
  const input = { source, currentAstNodeId: 1, scopeChain: [{id:'external',bindings:{revoke}}],
    callStack: [], pendingPromises: [], moduleBindings: {} };
  expect(JSON.stringify(serialize(input))).toContain('proxy-only-secret');
  await invokeBuiltinClosure(revoke, [], new Budget(), undefined, undefined);
  const wire = serialize(input);
  expect(JSON.stringify(wire)).not.toContain('proxy-only-secret');
  expect(Object.values(wire.heap ?? {}).some(node => node.kind === 'guest-proxy')).toBe(false);
  expect(() => restoreGraph(JSON.parse(JSON.stringify(wire)), { source })).not.toThrow();
});

it("invokes and revokes a restored callable graph without replaying source", async () => {
  const budget = new Budget(), builtins = createBuiltinBindings({ budget });
  const proxy = createGuestProxy(builtins.Math.abs, {}), revoke = createGuestProxyRevoker(proxy);
  const source = 'return 0';
  const wire = serialize({ source, currentAstNodeId: 1, scopeChain: [{id:'external',bindings:{proxy,revoke}}],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restoreGraph(JSON.parse(JSON.stringify(wire)), { source });
  const fn = restored.currentScope.lookup('proxy').value as SandboxClosure;
  const revokeFn = restored.currentScope.lookup('revoke').value as SandboxClosure;
  const context: SandboxCallContext = {stack:[],thisValue:undefined,
    getProperty: (value, key) => sandboxGetProperty(value, key, value, restored.budget, context)};
  expect(await invokeBuiltinClosure(fn, [-3], restored.budget, context, undefined)).toBe(3);
  await invokeBuiltinClosure(revokeFn, [], restored.budget, context, undefined);
  await expect(invokeBuiltinClosure(fn, [-3], restored.budget, context, undefined)).rejects.toThrow(TypeError);
  expect(guestProxyStates.get(fn)).toEqual({target:null,handler:null});
});

it.each(['primitive', 'wrong-kind', 'self', 'extra'])("rejects malformed revoker graph state: %s", corruption => {
  const source = 'return 0', proxy = createGuestProxy({}, {}), revoke = createGuestProxyRevoker(proxy);
  const wire = JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1,
    scopeChain: [{id:'external',bindings:{revoke}}], callStack: [], pendingPromises: [], moduleBindings: {} })));
  const [id, node] = Object.entries(wire.heap).find(([, value]) => (value as {kind:string}).kind === 'guest-proxy-revoker')! as [string, Record<string, unknown>];
  if (corruption === 'primitive') node.proxy = 7;
  if (corruption === 'self') node.proxy = {kind:'ref',id:Number(id)};
  if (corruption === 'wrong-kind') node.proxy = wire.heap[(node.proxy as {id:number}).id].target;
  if (corruption === 'extra') node.extra = {};
  expect(() => restoreGraph(wire, { source })).toThrow();
});

it("preserves private Proxy edges and cycles in the serialized graph", () => {
  const target: Record<string, RuntimeSnapshotValue> = { x: 2 }, handler = {};
  const proxy = createGuestProxy(target, handler);
  target.self = proxy;
  const source = 'return 0';
  const wire = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: 'external', bindings: { proxy, target, handler } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restoreGraph(JSON.parse(JSON.stringify(wire)), { source });
  const value = restored.currentScope.lookup('proxy').value as object;
  const state = guestProxyStates.get(value);
  expect(state).toBeDefined();
  expect(state?.target).toBe(restored.currentScope.lookup('target').value);
  expect(state?.handler).toBe(restored.currentScope.lookup('handler').value);
  expect((state?.target as Record<string, unknown>).self).toBe(value);
});

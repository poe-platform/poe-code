import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  ["idle", `const calls=[];const original=new AsyncDisposableStack();const value={id:7};original.adopt(value,v=>calls.push(v===value));const stack=original.move();return async()=>{await stack.disposeAsync();return [original.disposed,stack.disposed,calls]}`, [true,true,[true]]],
  ["pending", `const calls=[];const c=Promise.withResolvers();const stack=new AsyncDisposableStack();stack.defer(()=>calls.push('last'));stack.defer(()=>{calls.push('first');return c.promise});const result=stack.disposeAsync();await 0;return async()=>{c.resolve();await result;return [stack.disposed,calls]}`, [true,['first','last']]],
  ["pending rejection", `const first={},second={};const c=Promise.withResolvers();const stack=new AsyncDisposableStack();stack.defer(()=>c.promise);stack.defer(()=>{throw first});const result=stack.disposeAsync();await 0;return async()=>{c.reject(second);try{await result}catch(e){return [e instanceof SuppressedError,e.error===second,e.suppressed===first]}}`, [true,true,true]]
] as const)("restores %s async cleanup through JSON", async (_name, source, expected) => {
  const fresh=await run(source);
  assert(fresh.ok);
  const snapshot=serialize({source,currentAstNodeId:1,
    scopeChain:[{id:'module',bindings:{read:fresh.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();
  const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget}).currentScope.lookup('read');
  assert(binding.found && isSandboxClosure(binding.value));
  const value=await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined);
  expect(await awaitSandboxValue(value,undefined,budget)).toEqual(expected);
});

it("rejects a cleanup producer redirected to the wrong promise", async () => {
  const source="const c=Promise.withResolvers();const stack=new AsyncDisposableStack();stack.defer(()=>c.promise);return [stack.disposeAsync(),c.resolve]";
  const fresh=await run(source);assert(fresh.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{value:fresh.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  assert(snapshot.heap !== undefined);
  const match=Object.entries(snapshot.heap).find(([,node])=>node.kind==='promise-reaction' && node.aggregate !== undefined);
  assert(match !== undefined);
  const [id,node]=match;assert(node.kind==='promise-reaction');
  assert(node.aggregate !== null && typeof node.aggregate==='object' && 'kind' in node.aggregate && node.aggregate.kind==='ref' && 'id' in node.aggregate && typeof node.aggregate.id==='number');
  assert(node.source !== null && typeof node.source==='object' && 'kind' in node.source && node.source.kind==='ref' && 'id' in node.source && typeof node.source.id==='number');
  const owner=snapshot.heap[node.aggregate.id];const input=snapshot.heap[node.source.id];
  assert(owner?.kind==='pending-promise' && input?.kind==='pending-promise');
  delete owner.producers;input.producers=[{kind:'ref',id:Number(id)}];node.aggregate=node.source;
  expect(()=>restore(JSON.parse(JSON.stringify(snapshot)),{source})).toThrow('Invalid promise aggregate handler ownership');
});

it("rejects a cleanup capability resolver belonging to another promise", async () => {
  const source="const c=Promise.withResolvers();const stack=new AsyncDisposableStack();stack.defer(()=>c.promise);return [stack.disposeAsync(),c.resolve]";
  const fresh=await run(source);assert(fresh.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{value:fresh.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  assert(snapshot.heap !== undefined);
  const cleanup=Object.values(snapshot.heap).find(node=>node.kind==='async-cleanup');assert(cleanup?.kind==='async-cleanup');
  const other=Object.entries(snapshot.heap).find(([,node])=>node.kind==='promise-resolver' && node.action==='fulfilled' && JSON.stringify(node.promise)!==JSON.stringify(cleanup.capability.promise));
  assert(other !== undefined);cleanup.capability.resolve={kind:'ref',id:Number(other[0])};
  expect(()=>restore(JSON.parse(JSON.stringify(snapshot)),{source})).toThrow('Invalid async cleanup resolver ownership');
});

import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each(['using','await using'])("restores captured %s resources in suspended generators", async head => {
  const source=`const events=[];const resource={[Symbol.dispose](){events.push('captured')}};
    async function* values(){${head} value=resource;yield 1}
    const iterator=values();await iterator.next();resource[Symbol.dispose]=()=>events.push('changed');
    return async()=>{await iterator.return();return events};`;
  const fresh=await run(source);assert(fresh.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{read:fresh.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget}).currentScope.lookup('read');
  assert(binding.found && isSandboxClosure(binding.value));
  const value=await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined);
  expect(await awaitSandboxValue(value,undefined,budget)).toEqual(['captured']);
});

it("restores a pending async disposal without repeating the body or disposer", async () => {
  const source=`const events=[];const c=Promise.withResolvers();
    const pending=(async()=>{await using value={[Symbol.asyncDispose](){events.push('dispose');return c.promise}};events.push('body');return 7})();
    return async()=>{c.resolve();return [await pending,events]};`;
  const fresh=await run(source);assert(fresh.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{read:fresh.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget}).currentScope.lookup('read');
  assert(binding.found && isSandboxClosure(binding.value));
  const value=await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined);
  expect(await awaitSandboxValue(value,undefined,budget)).toEqual([7,['body','dispose']]);
});

it("restores cleanup of an inner block and then executes the following statements once", async () => {
  const source=`const events=[];const c=Promise.withResolvers();
    const pending=(async()=>{events.push('before');{await using value={[Symbol.asyncDispose](){events.push('dispose');return c.promise}};events.push('body')}events.push('after');return 9})();
    return async()=>{c.resolve();return [await pending,events]};`;
  const fresh=await run(source);assert(fresh.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{read:fresh.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget}).currentScope.lookup('read');
  assert(binding.found && isSandboxClosure(binding.value));
  const value=await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined);
  expect(await awaitSandboxValue(value,undefined,budget)).toEqual([9,['before','body','dispose','after']]);
});

it("rejects malformed scope resource ownership", async () => {
  const source=`function* values(){using r={[Symbol.dispose](){}};yield 1}const iterator=values();iterator.next();return iterator;`;
  const fresh=await run(source);assert(fresh.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{iterator:fresh.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const wire=JSON.parse(JSON.stringify(snapshot));
  const frame=Object.values(wire.heap as Record<string, {kind:string;resourceState?:unknown}>).find(node=>node.kind==='scope-frame' && node.resourceState!==undefined);
  assert(frame);frame.resourceState={kind:'number',value:1};
  expect(()=>restore(wire,{source})).toThrow();
});

it.each([
  `for(await using value of [{[Symbol.asyncDispose](){events.push('dispose');return c.promise}}]){events.push('body')}`,
  `for await(await using value of [{[Symbol.asyncDispose](){events.push('dispose');return c.promise}}]){events.push('body')}`,
  `outer:for(let i=0;i<1;i++){for(await using value of [{[Symbol.asyncDispose](){events.push('dispose');return c.promise}}]){events.push('body');continue outer}}`,
  `outer:for(let i=0;i<1;i++){for(await using value of [{[Symbol.asyncDispose](){events.push('dispose');return c.promise}}]){events.push('body');break outer}}`,
  `for(await using value={[Symbol.asyncDispose](){events.push('dispose');return c.promise}};false;){}`,
  `switch(1){case 1:await using value={[Symbol.asyncDispose](){events.push('dispose');return c.promise}};events.push('body');break}`
])("restores pending cleanup of a non-block lexical scope: %s", async body => {
  const source=`const events=[];const c=Promise.withResolvers();const pending=(async()=>{${body};events.push('after');return 1})();return async()=>{c.resolve();return [await pending,events]};`;
  const fresh=await run(source);assert(fresh.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{read:fresh.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget}).currentScope.lookup('read');
  assert(binding.found && isSandboxClosure(binding.value));
  const value=await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined);
  expect(await awaitSandboxValue(value,undefined,budget)).toEqual([1,[...(body.includes("events.push('body')") ? ['body'] : []),'dispose','after']]);
});

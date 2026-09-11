import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure, isSandboxPromise } from "../interp/values.js";
import { asyncGeneratorRequestOwners } from "../interp/async-generator-driver.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  ['events.push("before");return 1+await c.promise;', 8, ['before']],
  ['return [events.push("before"),await c.promise,events.push("after")];', [1,7,2], ['before','after']],
  ['try{return await c.promise}finally{events.push("finally")}', 7, ['finally']],
  ['const obj={value:7};return obj[await c.promise];', undefined, []],
  ['const value=await c.promise;return await Promise.resolve(value+1);', 8, []],
  ['const value=await c.promise;return await (async()=>{await 0;return value+1})();', 8, []],
  ['events.push("before");for await(const value of [c.promise])return value;', 7, ['before']],
  ['let total=0;for await(const value of [c.promise,2,3]){events.push(value);total+=value}return total;', 12, [7,2,3]],
  ['async function* values(){events.push("generator");yield await c.promise}for await(const value of values())return value;', 7, ['generator']],
  ['async function* values(){events.push("generator");yield c.promise}for await(const value of values())return value;', 7, ['generator']],
  ['async function* values(){events.push("generator");return c.promise}return (await values().next()).value;', 7, ['generator']],
  ['async function* values(){events.push("delegate");yield* [c.promise,2]}return (await values().next()).value;', 7, ['delegate']],
  ['const it={[Symbol.asyncIterator](){return this},next(){events.push("next");return c.promise.then(value=>({done:false,value}))}};async function* values(){yield* it}return (await values().next()).value;', 7, ['next']],
  ['const delegate={[Symbol.asyncIterator](){return this},next(){return {done:false,value:1}},return(value){events.push(value);return c.promise.then(()=>({done:true,value:9}))}};async function* values(){yield* delegate}const it=values();await it.next();return await it.return(4);', {value:9,done:true}, [4]],
  ['const delegate={[Symbol.asyncIterator](){return this},next(){return {done:false,value:1}},return(){events.push("close");return c.promise.then(()=>({done:true}))}};async function* values(){yield* delegate}const it=values();await it.next();try{await it.throw(4)}catch(error){return error.name}', 'TypeError', ['close']],
  ['async function* values(){events.push("generator");yield await c.promise;yield 2;return 3}const it=values();return await Promise.all([it.next(),it.next(),it.next(),it.next()]);', [{value:7,done:false},{value:2,done:false},{value:3,done:true},{value:undefined,done:true}], ['generator']],
  ['async function* values(){yield 1}return (await values().return(c.promise)).value;', 7, []],
  ['async function* values(){try{yield 1}finally{await c.promise;events.push("closed")}}const it=values();await it.next();return (await it.return(9)).value;', 9, ['closed']],
  ['async function* values(){try{yield 1}catch(error){events.push(error);yield 2}finally{events.push("finally")}}const it=values();await it.next();return await it.return(c.promise.then(()=>{throw 7}));', {value:2,done:false}, [7]],
  ['async function* values(){await using resource={[Symbol.asyncDispose](){events.push("dispose");return c.promise}};events.push("body");return 9}return await values().next();', {value:9,done:true}, ['body','dispose']],
  ['const it={[Symbol.iterator](){return this},next(){return {done:false,value:1}},return(){events.push("close");return {done:true,value:c.promise}}};for await(const value of it){break}return 9;', 9, ['close']],
  ['const it={[Symbol.iterator](){return this},next(){return {done:false,value:c.promise.then(()=>{throw "value"})}},return(){events.push("close");return {done:true}}};try{for await(const value of it){events.push("body")}}catch(error){return error}', 'value', ['close']],
  ['const it={[Symbol.asyncIterator](){return this},next(){events.push("next");return c.promise.then(value=>({done:false,value}))},return(){events.push("close");return {done:true}}};for await(const value of it)return value;', 7, ['next','close']],
  ['const it={[Symbol.asyncIterator](){return this},next(){return {done:false,value:1}},return(){events.push("close");return c.promise.then(()=>({done:true}))}};for await(const value of it){events.push("body");return 9}', 9, ['body','close']],
  ['const it={[Symbol.asyncIterator](){return this},next(){return {done:false,value:1}},return(){events.push("close");return c.promise.then(()=>{throw "close"})}};try{for await(const value of it){throw "body"}}catch(error){return error}', 'body', ['close']],
  ['events.push("before");return c.promise;', 7, ['before']],
  ['return {then(resolve){events.push("then");c.promise.then(resolve)}};', 7, ['then']]
] as const)("restores ordinary async execution without repeated effects: %s", async (body, result, events) => {
  const source=`const events=[];const c=Promise.withResolvers();const pending=(async()=>{${body}})();return async()=>{c.resolve(7);return [await pending,events]};`;
  const fresh=await run(source);assert(fresh.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{read:fresh.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget}).currentScope.lookup('read');
  assert(binding.found && isSandboxClosure(binding.value));
  const value=await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined);
  expect(await awaitSandboxValue(value,undefined,budget)).toEqual([result,events]);
});

it("restores a queued request captured directly and preserves its owner across another snapshot", async () => {
  const source = "const c=Promise.withResolvers();async function* values(){yield await c.promise;yield 2}const it=values();it.next();return [it.next(),c.resolve]";
  const fresh = await run(source);assert(fresh.ok);
  const [pending, resolve] = fresh.returnValue as RuntimeSnapshotValue[];
  let snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{pending:pending!,resolve:resolve!}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  for (let cycle=0;cycle<2;cycle++) {
    const budget = new Budget();
    const restored = restore(JSON.parse(JSON.stringify(snapshot)), {source,budget});
    const request = restored.currentScope.lookup("pending");
    const resolver = restored.currentScope.lookup("resolve");
    assert(request.found && isSandboxPromise(request.value));
    assert(resolver.found && isSandboxClosure(resolver.value));
    const owner = asyncGeneratorRequestOwners.get(request.value);
    expect(owner?.requests[1]?.capability.promise).toBe(request.value);
    if (cycle === 0) {
      snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{pending:request.value,resolve:resolver.value}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    } else {
      await invokeBuiltinClosure(resolver.value,[7],budget,undefined,undefined);
      expect(await awaitSandboxValue(request.value,undefined,budget)).toEqual({value:2,done:false});
      expect(asyncGeneratorRequestOwners.has(request.value)).toBe(false);
    }
  }
});

it("unwinds a restored async generator when its new host signal is cancelled", async () => {
  const source = "let cleaned=false;async function* values(){try{await new Promise(()=>{});yield 1}finally{cleaned=true}}return [values().next(),()=>cleaned]";
  const fresh = await run(source);assert(fresh.ok);
  const [request, read] = fresh.returnValue as RuntimeSnapshotValue[];
  const snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{request:request!,read:read!}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget = new Budget();
  const controller = new AbortController();
  const restored = restore(JSON.parse(JSON.stringify(snapshot)), {source,budget,signal:controller.signal});
  const reader = restored.currentScope.lookup("read");
  assert(reader.found && isSandboxClosure(reader.value));
  const pending = restored.currentScope.lookup("request");
  assert(pending.found && isSandboxPromise(pending.value));
  controller.abort(new Error("stop"));
  await expect(pending.value.promise).rejects.toMatchObject({message:"stop"});
  expect(await invokeBuiltinClosure(reader.value,[],budget,undefined,undefined)).toBe(true);
});

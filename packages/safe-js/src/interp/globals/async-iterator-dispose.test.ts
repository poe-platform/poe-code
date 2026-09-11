import { assert, expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { awaitSandboxValue } from "../cancel.js";
import { isSandboxClosure } from "../values.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore } from "../../snapshot/restore.js";

const method = "(async function*(){})()[Symbol.asyncDispose]";

it("closes and awaits an async generator through AsyncDisposableStack", async () => {
  expect(await run(`const calls=[];async function* values(){try{yield 1}finally{await 0;calls.push('closed')}}
    const iterator=values();await iterator.next();const stack=new AsyncDisposableStack();stack.use(iterator);await stack.disposeAsync();
    return [calls,(await iterator.next()).done];`)).toMatchObject({ok:true,returnValue:[['closed'],true]});
});

it("preserves the receiver and awaits return without exposing its value", async () => {
  expect(await run(`const calls=[];const dispose=${method};const value={get return(){calls.push('get');return async function(){calls.push([this===value,arguments.length]);await 0;calls.push('done');return 7}}};
    const result=dispose.call(value,1);return [result instanceof Promise,await result,calls];`))
    .toMatchObject({ok:true,returnValue:[true,undefined,['get',[true,0],'done']]});
});

it("rejects property and call failures through promises", async () => {
  expect(await run(`const dispose=${method};const failure={};const errors=[];
    for(const value of [null,undefined,{return:1},{get return(){throw failure}},{return(){throw failure}},{return(){return Promise.reject(failure)}}]){
      let promise;try{promise=dispose.call(value)}catch(e){return 'synchronous'};
      try{await promise}catch(e){errors.push(e===failure?'same':e.name)}
    }return errors;`)).toMatchObject({ok:true,returnValue:['TypeError','TypeError','TypeError','same','same','same']});
});

it("accepts unbranded receivers and missing methods", async () => {
  expect(await run(`const dispose=${method};const results=[];for(const value of [{},{return:null},1,'x',true,Symbol()])results.push(await dispose.call(value));return results`))
    .toMatchObject({ok:true,returnValue:Array(6).fill(undefined)});
});

it("uses intrinsic promise resolution without reading then on same-constructor promises", async () => {
  expect(await run(`const dispose=${method};const result=Promise.resolve(7);Object.defineProperty(result,'then',{get(){throw 'wrong'}});
    Promise.resolve=()=>{throw 'wrong'};return await dispose.call({return(){return result}});`))
    .toMatchObject({ok:true,returnValue:undefined});
});

it("exposes the standard descriptor and method metadata", async () => {
  expect(await run(`const iterator=(async function*(){})();let p=Object.getPrototypeOf(iterator);while(!Object.hasOwn(p,Symbol.asyncDispose))p=Object.getPrototypeOf(p);
    const d=Object.getOwnPropertyDescriptor(p,Symbol.asyncDispose);return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable];`))
    .toMatchObject({ok:true,returnValue:['[Symbol.asyncDispose]',0,true,false,true]});
});

it.each(['c.promise','{then(resolve){c.promise.then(resolve)}}'])("restores pending disposal through %s without repeating return", async returned => {
  const source=`let calls=0;const c=Promise.withResolvers();const dispose=${method};const value={return(){calls++;return ${returned}}};
    const pending=dispose.call(value);return async()=>{c.resolve(7);return [await pending,calls]}`;
  const fresh=await run(source);assert(fresh.ok);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{read:fresh.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget}).currentScope.lookup('read');
  assert(binding.found && isSandboxClosure(binding.value));
  const value=await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined);
  expect(await awaitSandboxValue(value,undefined,budget)).toEqual([undefined,1]);
});

it("rejects a throwing returned-promise constructor getter", async () => {
  expect(await run(`const dispose=${method};const value=Promise.resolve(7);const failure={};Object.defineProperty(value,'constructor',{get(){throw failure}});
    const pending=dispose.call({return(){return value}});try{await pending}catch(e){return e===failure}`))
    .toMatchObject({ok:true,returnValue:true});
});

it("assimilates thenables and discards their fulfilled payloads", async () => {
  expect(await run(`const events=[];const dispose=${method};const value={get then(){events.push('get');return function(resolve){events.push(this===value);resolve(7)}}};
    const result=await dispose.call({return(){return value}});return [result,events];`))
    .toMatchObject({ok:true,returnValue:[undefined,['get',true]]});
});

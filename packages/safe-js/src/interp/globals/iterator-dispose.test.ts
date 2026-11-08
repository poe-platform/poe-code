import { expect, it } from "vitest";
import { run } from "../../run.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore } from "../../snapshot/restore.js";
import { isSandboxClosure } from "../values.js";

it("closes a suspended generator through DisposableStack", async () => {
  expect(await run(`let closed=0;function* values(){try{yield 1;yield 2}finally{closed++}}
    const iterator=values();iterator.next();const stack=new DisposableStack();stack.use(iterator);stack.dispose();
    return [closed,iterator.next().done];`)).toMatchObject({ok:true,returnValue:[1,true]});
});

it("reads return on each invocation, preserves the receiver, and ignores results", async () => {
  expect(await run(`const calls=[];const receiver={get return(){calls.push('get');return function(){calls.push([this===receiver,arguments.length]);return 7}}};
    const dispose=Iterator.prototype[Symbol.dispose];const first=dispose.call(receiver,1);const second=dispose.call(receiver);
    return [first,second,calls];`)).toMatchObject({ok:true,returnValue:[undefined,undefined,['get',[true,0],'get',[true,0]]]});
});

it("accepts missing and nullish return methods without requiring an iterator brand", async () => {
  expect(await run(`const dispose=Iterator.prototype[Symbol.dispose];return [{},{return:null},{return:undefined},1,'text',true,Symbol()].map(value=>dispose.call(value))`))
    .toMatchObject({ok:true,returnValue:Array(7).fill(undefined)});
});

it("rejects nullish receivers and non-callable return methods", async () => {
  expect(await run(`const errors=[];const dispose=Iterator.prototype[Symbol.dispose];for(const value of [null,undefined,{return:1}]){try{dispose.call(value)}catch(e){errors.push(e.name)}}return errors`))
    .toMatchObject({ok:true,returnValue:['TypeError','TypeError','TypeError']});
});

it("preserves getter and return-method failures", async () => {
  expect(await run(`const failure={};const dispose=Iterator.prototype[Symbol.dispose];const seen=[];
    for(const value of [{get return(){throw failure}},{return(){throw failure}}]){try{dispose.call(value)}catch(e){seen.push(e===failure)}}return seen;`))
    .toMatchObject({ok:true,returnValue:[true,true]});
});

it("does not await a promise returned by return", async () => {
  expect(await run(`return Iterator.prototype[Symbol.dispose].call({return(){return new Promise(()=>{})}})`))
    .toMatchObject({ok:true,returnValue:undefined});
});

it("provides the standard method descriptor and inherited array-iterator method", async () => {
  expect(await run(`const d=Object.getOwnPropertyDescriptor(Iterator.prototype,Symbol.dispose);return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable,[][Symbol.iterator]()[Symbol.dispose]===d.value]`))
    .toMatchObject({ok:true,returnValue:['[Symbol.dispose]',0,true,false,true,true]});
});

it("restores an escaped disposal method through JSON after the prototype is changed", async () => {
  const source=`const dispose=Iterator.prototype[Symbol.dispose];let closed=0;const iterator={return(){closed++}};
    Iterator.prototype[Symbol.dispose]=undefined;return ()=>{dispose.call(iterator);return closed}`;
  const result=await run(source);if(!result.ok)throw result.error;
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source}).currentScope.lookup('read');
  if(!binding.found || !isSandboxClosure(binding.value))throw new Error('missing reader');
  expect(await binding.value.call([])).toBe(1);
});

import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { Budget } from "./budget.js";
import { measureSandboxData } from "./values.js";
import { nextStringIterator, restoreSandboxStringIterator } from "./string-iterator.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore as restoreRuntime } from "../snapshot/restore.js";
import { validateGuestHeapNode } from "../snapshot/guest-heap-validation.js";

it("reads the string iterator method through a primitive receiver", async () => {
  const result=await run("return typeof 'text'[Symbol.iterator]");
  assert(result.ok);
  expect(result.returnValue).toBe("function");
});

it("charges retained input until the iterator is exhausted", () => {
  const iterator=restoreSandboxStringIterator({input:'a😀',index:0});
  const budget=new Budget();
  expect(measureSandboxData([iterator,iterator])).toBe(4);
  expect(nextStringIterator(iterator,budget)).toEqual({value:'a',done:false});
  expect(nextStringIterator(iterator,budget)).toEqual({value:'😀',done:false});
  expect(measureSandboxData([iterator])).toBe(4);
  expect(nextStringIterator(iterator,budget)).toEqual({value:undefined,done:true});
  expect(measureSandboxData([iterator])).toBe(1);
});

it("restores a partially consumed low-level iterator and its metadata cycle", async () => {
  const source="return 'a😀b'[Symbol.iterator]()";
  const result=await run(source);
  assert(result.ok);
  const iterator=result.returnValue;
  assert(iterator!==null && typeof iterator==='object');
  Object.defineProperty(iterator,'self',{value:iterator});
  const budget=new Budget();
  expect(nextStringIterator(iterator,budget)).toEqual({value:'a',done:false});
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'external',bindings:{it:iterator as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const binding=restoreRuntime(JSON.parse(JSON.stringify(snapshot)),{source}).currentScope.lookup('it');
  assert(binding.found);
  const restored=binding.value as typeof iterator;
  expect(Object.getOwnPropertyDescriptor(restored,'self')!.value).toBe(restored);
  expect(nextStringIterator(restored,budget)).toEqual({value:'😀',done:false});
  expect(nextStringIterator(restored,budget)).toEqual({value:'b',done:false});
  expect(nextStringIterator(restored,budget)).toEqual({value:undefined,done:true});
});

it.each([
  {input:'ab',index:-1},
  {input:'ab',index:3},
  {input:'ab',index:0.5},
  {input:7,index:0},
  {input:{kind:'undefined'},index:1},
  {input:'😀',index:1}
])("rejects an invalid string iterator cursor %j", cursor => {
  const node={kind:'string-iterator',...cursor,state:{properties:{properties:[],extensible:true}}};
  expect(()=>validateGuestHeapNode(node,{},100)).toThrow(TypeError);
});

it.each([
  "const it='a😀\\ud800b'[Symbol.iterator]();return [it.next(),it.next(),it.next(),it.next(),it.next(),it.next()]",
  "const it=''[Symbol.iterator]();return [it.next(),it.next()]",
  "const fn=String.prototype[Symbol.iterator];const it=fn.call(123);return [fn.name,fn.length,Array.from(it)]",
  "const it='x'[Symbol.iterator]();return [it[Symbol.iterator]()===it,Reflect.ownKeys(it),Object.prototype.toString.call(it),Object.getPrototypeOf(Object.getPrototypeOf(it))===Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))]",
  "const fn=String.prototype[Symbol.iterator];const proto=Object.getPrototypeOf(fn.call(''));const method=Object.getOwnPropertyDescriptor(String.prototype,Symbol.iterator);const next=Object.getOwnPropertyDescriptor(proto,'next');const tag=Object.getOwnPropertyDescriptor(proto,Symbol.toStringTag);return [method.writable,method.enumerable,method.configurable,next.writable,next.enumerable,next.configurable,next.value.name,next.value.length,tag]",
  "const events=[];const value={toString(){events.push('coerce');return 'ab'}};const it=String.prototype[Symbol.iterator].call(value);events.push('created');value.toString=()=>{throw 'recoerced'};return [events,it.next(),it.next()]",
  "const next=Object.getPrototypeOf('x'[Symbol.iterator]()).next;const values=[{},'x',[][Symbol.iterator]()];return values.map(value=>{try{next.call(value);return 'accepted'}catch(error){return error.name}})",
  "return [null,undefined,Symbol('x')].map(value=>{try{String.prototype[Symbol.iterator].call(value);return 'accepted'}catch(error){return error.name}})",
  "const it='x'[Symbol.iterator]();try{structuredClone(it);return 'accepted'}catch(error){return error.name}",
  "const original=String.prototype[Symbol.iterator];try{String.prototype[Symbol.iterator]=function(){return [7,8][Symbol.iterator]()};const values=[];for(const value of 'ab')values.push(value);return [values,[...'ab'],Array.from('ab')]}finally{String.prototype[Symbol.iterator]=original}"
])("matches native string iteration: %s", async source => {
  const expected=Function("'use strict';"+source)();
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
});

it("preserves the string iterator cursor and custom metadata through public replay", async () => {
  const source="const it='a😀b'[Symbol.iterator]();it.self=it;const first=it.next();await 0;return [first,it.next(),it.self===it,Array.from(it),it.next()]";
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual([{value:'a',done:false},{value:'😀',done:false},true,['b'],{value:undefined,done:true}]);
  const resumed=await run(source,{snapshot:JSON.parse(await dump(result))});
  assert(resumed.ok);
  expect(resumed.returnValue).toEqual(result.returnValue);
});

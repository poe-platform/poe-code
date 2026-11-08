import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { createSandboxClosure, isSandboxClosure } from "../values.js";
import { Budget } from "../budget.js";
import { createReflectGlobal } from "./reflect.js";
import { serialize } from "../../snapshot/serialize.js";
import { restore as restoreRuntime } from "../../snapshot/restore.js";

it.each([
  ["own keys", "const s=Symbol('s');const a={2:0,a:1,[s]:2};Object.defineProperty(a,'hidden',{value:3});return Reflect.ownKeys(a).map(String)"],
  ["own descriptor", "const a={x:1};return [Reflect.getOwnPropertyDescriptor(a,'x'),Reflect.getOwnPropertyDescriptor(a,'missing')]"],
  ["prototype", "const p={};const a=Object.create(p);return [Reflect.getPrototypeOf(a)===p,Reflect.getPrototypeOf(Object.create(null))]"],
  ["inherited membership", "const a=Object.create({x:1});return [Reflect.has(a,'x'),Reflect.has(a,'missing')]"],
  ["extensibility", "const a={};return [Reflect.isExtensible(a),Reflect.preventExtensions(a),Reflect.isExtensible(a)]"],
  ["property definition failure", "const a={};Object.preventExtensions(a);return Reflect.defineProperty(a,'x',{value:1})"],
  ["property definition", "const a={};return [Reflect.defineProperty(a,'x',{value:2,writable:true}),a.x,Object.getOwnPropertyDescriptor(a,'x')]"],
  ["delete", "const a={x:1};Object.defineProperty(a,'fixed',{value:2});return [Reflect.deleteProperty(a,'x'),Reflect.deleteProperty(a,'fixed'),Reflect.deleteProperty(a,'missing')]"],
  ["get receiver", "const a={get x(){return this===undefined?'undefined':this.y}};return [Reflect.get(a,'x',{y:7}),Reflect.get(a,'x',undefined)]"],
  ["set receiver", "const a={x:1};const b={};const ok=Reflect.set(a,'x',2,b);return [ok,a.x,b.x,Reflect.set(a,'x',3,undefined)]"],
  ["prototype mutation failure", "const a={};const p={};Object.preventExtensions(a);return [Reflect.setPrototypeOf(a,p),Reflect.setPrototypeOf(a,Object.getPrototypeOf(a))]"],
  ["apply array-like arguments", "function f(x,y){return this.base+x+y}return Reflect.apply(f,{base:10},{length:2,0:2,1:3})"],
  ["construct new target", "function A(x){this.x=x}function B(){}const a=Reflect.construct(A,[7],B);return [a.x,a instanceof B,a instanceof A]"],
  ["reject primitive before key conversion", "const events=[];for(const name of ['get','getOwnPropertyDescriptor','has','deleteProperty','set','defineProperty']){try{Reflect[name](1,{toString(){events.push('key');return 'x'}},1)}catch(e){events.push(e.name)}}return events"],
  ["propagate user descriptor exceptions", "try{Reflect.defineProperty({},'x',{get value(){throw 'sentinel'}})}catch(e){return e}"],
  ["namespace shape", "return [typeof Reflect,Object.getPrototypeOf(Reflect)===Object.prototype,Object.prototype.toString.call(Reflect),Object.getOwnPropertyDescriptor(Reflect,Symbol.toStringTag)]"],
  ["prototype cycles", "const a={};const b=Object.create(a);return [Reflect.setPrototypeOf(a,b),Reflect.setPrototypeOf(Object.prototype,{})]"],
  ["setter receiver and exceptions", "const seen=[];const a={set x(v){seen.push([this===undefined,v]);if(v===2)throw 'setter'}};const ok=Reflect.set(a,'x',1,undefined);try{Reflect.set(a,'x',2)}catch(e){seen.push(e)}return [ok,seen]"],
  ["read-only data and accessor receivers", "const a={x:1};const b={get x(){return 2}};Object.defineProperty(a,'fixed',{value:3});return [Reflect.set(a,'fixed',4),Reflect.set(a,'x',4,b)]"],
  ["array length object conversion", "const a=[1,2,3];const seen=[];const ok=Reflect.defineProperty(a,'length',{value:{valueOf(){seen.push('convert');return 1}}});return [ok,a,seen]"],
  ["array shrink partial failure", "const a=[1,2,3];Object.defineProperty(a,'1',{configurable:false});return [Reflect.defineProperty(a,'length',{value:0}),a.length,Reflect.has(a,'2')]"],
  ["typed array writes", "const a=new Uint8Array(1);const seen=[];return [Reflect.set(a,'0',257),a[0],Reflect.set(a,'2',{valueOf(){seen.push('convert');return 4}}),Reflect.defineProperty(a,'2',{value:3}),seen]"],
  ["typed array replacement receiver", "const a=new Uint8Array([1]);const receiver={};return [Reflect.set(a,'0',2,receiver),Reflect.set(a,'5',3,receiver),receiver,a[0]]"],
  ["inherited typed array replacement receiver", "const a=new Uint8Array(1);const p=Object.create(a);const receiver={};return [Reflect.set(p,'2',7,receiver),Reflect.ownKeys(receiver)]"],
  ["built-in object metadata", "const values=[new Map(),new Set(),Promise.resolve(1),(function*(){})(),new Date(0),new Number(1),new Error('x')];return values.map(a=>{const s=Symbol('s');Reflect.defineProperty(a,s,{value:7,configurable:true});return [Reflect.has(a,s),Reflect.get(a,s),Reflect.ownKeys(a).includes(s),Reflect.deleteProperty(a,s)]})"],
  ["apply argument validation order", "const seen=[];const args={get length(){seen.push('length');return 0}};try{Reflect.apply(1,null,args)}catch(e){seen.push(e.name)}try{Reflect.apply(()=>1,null,null)}catch(e){seen.push(e.name)}return seen"],
  ["construct argument validation order", "const seen=[];const args={get length(){seen.push('length');return 0}};try{Reflect.construct(function(){},args,()=>0)}catch(e){seen.push(e.name)}try{Reflect.construct(function(){},[],undefined)}catch(e){seen.push(e.name)}return seen"],
  ["construct built-in new target", "function B(){}const a=Reflect.construct(Array,[2],B);return [Array.isArray(a),a.length,Object.getPrototypeOf(a)===B.prototype]"],
  ["method descriptors", "return ['apply','construct','defineProperty','deleteProperty','get','getOwnPropertyDescriptor','getPrototypeOf','has','isExtensible','ownKeys','preventExtensions','set','setPrototypeOf'].map(key=>{const d=Object.getOwnPropertyDescriptor(Reflect,key);return [key,d.value.name,d.value.length,d.enumerable,d.writable,d.configurable]})"],
  ["namespace key order", "return Reflect.ownKeys(Reflect).map(String)"],
  ["two distinct array length conversions", "const a=[1,2];let n=0;const ok=Reflect.defineProperty(a,'length',{value:{valueOf(){return ++n===1?1.5:1}}});return [ok,n,a.length]"],
  ["invalid array lengths", "const errors=[];for(const value of [-1,1.5,Infinity,NaN,1n,undefined]){try{Reflect.defineProperty([],'length',{value});errors.push(false)}catch(e){errors.push(e.name)}}return errors"],
  ["coercion before read-only array length check", "const a=[1,2];Object.defineProperty(a,'length',{writable:false});let n=0;return [Reflect.defineProperty(a,'length',{value:{valueOf(){n++;return 1}}}),n,a.length]"],
  ["typed array detached during conversion", "const a=new Uint8Array(1);const value={valueOf(){a.buffer.transfer();return 7}};return [Reflect.defineProperty(a,'0',{value}),a.length]"],
  ["apply ignores argument iterators", "const args={length:2,0:3,1:4,[Symbol.iterator](){throw 'iterator'}};return Reflect.apply((a,b)=>a+b,null,args)"],
])("supports Reflect %s", async (_label, source) => {
  const result = await run(source);
  expect(result.ok).toBe(true);
  expect(result.returnValue).toEqual(Function(`'use strict';${source}`)());
});

it("ignores invalid typed-array indices with replacement receivers without coercion", async () => {
  // TypedArray [[Set]] 1.b.ii returns before conversion. Node 22/24 currently
  // convert anyway, so native execution is not a conforming oracle here.
  const source = "const a=new Uint8Array(1);const receiver={};let conversions=0;const value={valueOf(){conversions++;return 7}};const results=['-0','-1','1','1.5','NaN','Infinity'].map(key=>Reflect.set(a,key,value,receiver));a.buffer.transfer();results.push(Reflect.set(a,'0',value,receiver));return [results,Reflect.ownKeys(receiver),conversions]";
  const result = await run(source);
  expect(result.ok).toBe(true);
  expect(result.returnValue).toEqual([[true,true,true,true,true,true,true],[],0]);
});

it("restores Reflect method identities and namespace mutations", async () => {
  const source = "const method=Reflect.get;Reflect.extra={value:7};await 0;return [method===Reflect.get,Reflect.get(Reflect.extra,'value'),Reflect.ownKeys({x:1})]";
  const result = await run(source);
  expect(result).toMatchObject({ok:true,returnValue:[true,7,["x"]]});
  const snapshot = restore(JSON.parse(await dump(result)),{source});
  expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
});

it("invokes Reflect getters through SDK closures", async () => {
  const result=await run("return [Reflect.get,{get x(){return this.y}}, {y:9}]");
  const values=result.returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing Reflect.get closure");
  expect(await values[0].call([values[1],"x",values[2]])).toBe(9);
});

it("preserves newTarget through SDK Reflect.construct", async () => {
  const result=await run("function A(){this.own=new.target===B}function B(){}return [Reflect.construct,A,B]");
  const values=result.returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing Reflect.construct closure");
  expect(await values[0].call([values[1],[],values[2]])).toMatchObject({own:true});
});

it.each([
  'function A(){this.own=new.target===B}function B(){}',
  'function C(){this.own=new.target===B}const A=C.bind(null);function B(){}',
  'function C(){this.own=new.target===B}const A=new Proxy(C,{});function B(){}',
  'const A=new Proxy(function(){},{construct(t,args,n){return {own:n===B}}});function B(){}',
  'const A=new Proxy(function(){},{get construct(){return function(t,args,n){return {own:n===B}}}});function B(){}',
  'function A(){this.own=new.target===B}const B=new Proxy(function(){},{})'
])("preserves SDK constructor identity for %s", async setup => {
  const result = await run(`${setup};return [Reflect.construct,A,B]`);
  const values = result.returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Missing Reflect.construct closure");
  expect(await values[0].call([values[1], [], values[2]])).toMatchObject({own: true});
});

it("uses guest conversion when Object.defineProperty changes array length", async () => {
  const source = "const a=[1,2,3];const seen=[];Object.defineProperty(a,'length',{value:{valueOf(){seen.push('convert');return 1}}});return [a,seen]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it("budgets Reflect.ownKeys result allocation", async () => {
  const method=createReflectGlobal(new Budget({arrayLength:2})).ownKeys;
  if(!isSandboxClosure(method))throw new Error("Missing ownKeys");
  await expect(method.call([{a:1,b:2,c:3}])).rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength"});
});

it.each(["apply","construct"])("budgets Reflect.%s argument lists before invocation", async name => {
  let calls=0;
  const target=createSandboxClosure({guest:true,sandbox:true,call:()=>{calls++;return 1},construct:()=>{calls++;return {}}});
  const method=createReflectGlobal(new Budget({arrayLength:2}))[name];
  if(!isSandboxClosure(method))throw new Error("Missing Reflect method");
  await expect(method.call(name==="apply"?[target,undefined,{length:3}]:[target,{length:3}]))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength"});
  expect(calls).toBe(0);
});

it("restores Reflect closures through low-level snapshots", async () => {
  const source="const get=Reflect.get;const object={get x(){return this.y}};return ()=>get(object,'x',{y:7})";
  const result=await run(source);
  expect(result.ok).toBe(true);
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read:result.returnValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const binding=restoreRuntime(JSON.parse(JSON.stringify(snapshot)),{source}).currentScope.lookup("read");
  if(!binding.found||!isSandboxClosure(binding.value))throw new Error("Missing restored closure");
  expect(await binding.value.call([])).toBe(7);
});

it("evaluates SDK Reflect.apply array getters before invocation", async () => {
  const result=await run("return [Reflect.apply,function(x){return x},Object.defineProperty([],0,{get(){return 7},configurable:true})]");
  const values=result.returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0]))throw new Error("Missing Reflect.apply closure");
  expect(await values[0].call([values[1],undefined,values[2]])).toBe(7);
});

it.each(["apply","construct"])("budgets SDK Reflect.%s actual array arguments", async name => {
  let calls=0;
  const target=createSandboxClosure({guest:true,sandbox:true,call:()=>{calls++;return 9},construct:()=>{calls++;return {}}});
  const method=createReflectGlobal(new Budget({arrayLength:2}))[name];
  if(!isSandboxClosure(method))throw new Error("Missing Reflect method");
  await expect(method.call(name==="apply"?[target,undefined,[1,2,3]]:[target,[1,2,3]]))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength"});
  expect(calls).toBe(0);
});

it.each(["Object","Reflect"])("snapshots arrays after %s.defineProperty changes length", async namespace => {
  const source=`const a=[1,2,3];${namespace}.defineProperty(a,'length',{value:1});await 0;return [a,a.length]`;
  const result=await run(source);
  expect(result).toMatchObject({ok:true,returnValue:[[1],1]});
  const snapshot=restore(JSON.parse(await dump(result)),{source});
  expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
});

it.each(["Object","Reflect"])("preserves readonly array lengths after %s.defineProperty", async namespace => {
  const source=`const a=[1];${namespace}.defineProperty(a,'length',{writable:false});await 0;return Object.getOwnPropertyDescriptor(a,'length')`;
  const result=await run(source);
  expect(result).toMatchObject({ok:true,returnValue:{value:1,writable:false,enumerable:false,configurable:false}});
  const snapshot=restore(JSON.parse(await dump(result)),{source});
  expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
});

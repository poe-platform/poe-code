import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore as restoreGraph } from "../snapshot/restore.js";
import { getSandboxDataProperty, getSandboxPrototype, materializeFunctionProperties, releaseObjectPrototype } from "./object-model.js";
import { createSandboxClosure, isSandboxClosure, reconcileCompiledValues } from "./values.js";
import { createBuiltinBindings } from "./globals.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { declareHostOperation } from "./host-bridge.js";

it("retains changed intrinsic metadata even without guest roots", () => {
  const budget=new Budget({dataSize:500});
  createBuiltinBindings({budget});
  try {
    const prototype=getSandboxPrototype(createSandboxClosure({guest:true,call:()=>undefined}),budget);
    if(!isSandboxClosure(prototype))throw new Error("Missing function prototype");
    const method=getSandboxDataProperty(prototype,Symbol.hasInstance,budget);
    if(!isSandboxClosure(method))throw new Error("Missing intrinsic");
    materializeFunctionProperties(method).extra="x".repeat(10000);
    expect(()=>reconcileCompiledValues(budget,[])).toThrow("dataSize");
  }finally{releaseObjectPrototype(budget)}
});

it("replays a borrowed has-instance method across a pending effect", async () => {
  const source="function F(){}const method=Object.getPrototypeOf(F)[Symbol.hasInstance];const first=method.call(F,new F());await pause();return [first,method.call(F,new F()),{} instanceof F]";
  let release!:()=>void;
  let enter!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve});
  const entered=new Promise<void>(resolve=>{enter=resolve});
  const execution=run(source,{bindings:{pause:declareHostOperation(async()=>{enter();await gate},"re-issue")}});
  void execution.catch(()=>undefined);
  let saved:string;
  try{await Promise.race([entered,execution]);saved=await dump(execution,{mode:"replay"})}finally{release()}
  const expected=[true,true,false];
  expect(await execution).toMatchObject({ok:true,returnValue:expected});
  expect(await run(source,{snapshot:restore(JSON.parse(saved),{source}),bindings:{pause:declareHostOperation(async()=>{},"re-issue")}}))
    .toMatchObject({ok:true,returnValue:expected});
});

it.each([false,true])("restores an older function prototype heap (custom hook=%s)", async custom => {
  const source="const method=()=>true;return [Object.getPrototypeOf(method),method]";
  const original=await run(source);
  const saved=JSON.parse(JSON.stringify(serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{value:original.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}})));
  const entries=Object.entries(saved.heap) as Array<[string,{
    kind:string;id?:string;wellKnown?:string;state?:{properties:{properties:Array<[unknown,Record<string,unknown>]>}}
  }]>;
  const [,prototype]=entries.find(([,node])=>node.kind==="intrinsic"&&node.id==='["%FunctionPrototype%"]')!;
  const [symbolId]=entries.find(([,node])=>node.kind==="symbol"&&node.wellKnown==="hasInstance")!;
  const properties=prototype.state!.properties.properties;
  const symbolIndex=properties.findIndex(([key])=>typeof key==="object"&&key!==null&&(key as {id:number}).id===Number(symbolId));
  if(custom){
    const [closureId]=entries.find(([,node])=>node.kind==="guest-function")!;
    properties[symbolIndex][1]={kind:"data",value:{kind:"ref",id:Number(closureId)},writable:true,enumerable:false,configurable:true};
  }else properties.splice(symbolIndex,1);
  const restored=restoreGraph(saved,{source});
  const binding=restored.currentScope.lookup("value");
  if(!binding.found||!Array.isArray(binding.value))throw new Error("Missing restored legacy prototype");
  const method=getSandboxDataProperty(binding.value[0],Symbol.hasInstance,restored.budget);
  expect(method).toBe(custom?binding.value[1]:undefined);
});

it("restores a borrowed has-instance method by intrinsic identity", async () => {
  const source="function F(){}return [Object.getPrototypeOf(F)[Symbol.hasInstance],F,new F()]";
  const original=await run(source);
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{value:original.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored=restoreGraph(JSON.parse(JSON.stringify(saved)),{source});
  const binding=restored.currentScope.lookup("value");
  if(!binding.found||!Array.isArray(binding.value)||!isSandboxClosure(binding.value[0]))throw new Error("Missing restored method");
  expect(await binding.value[0].call([binding.value[2]],{stack:[],thisValue:binding.value[1]})).toBe(true);
});

it.each([
  "function F(){}const method=Object.getPrototypeOf(F)[Symbol.hasInstance];return [typeof method,method?.name,method?.length]",
  "function F(){}const method=Object.getPrototypeOf(F)[Symbol.hasInstance];return method.call(F,new F())",
  "const base=Object.getPrototypeOf(()=>{});const d=Object.getOwnPropertyDescriptor(base,Symbol.hasInstance);return d&&[d.writable,d.enumerable,d.configurable]",
  "function F(){}const method=Object.getPrototypeOf(F)[Symbol.hasInstance];Object.defineProperty(F,Symbol.hasInstance,{value(){return false}});return method.call(F,new F())",
  "function F(){}const method=Object.getPrototypeOf(F)[Symbol.hasInstance];Object.defineProperty(F,Symbol.hasInstance,{value(value){return value===7}});const bound=F.bind(null);return method.call(bound,7)",
  "const method=Object.getPrototypeOf(()=>{})[Symbol.hasInstance];return [method.call(null,{}),method.call(undefined,{}),method.call({},{}),method.call(7,{})]",
  "const method=Object.getPrototypeOf(()=>{})[Symbol.hasInstance];return method.call(()=>{},7)",
  "const method=Object.getPrototypeOf(()=>{})[Symbol.hasInstance];try{return method.call(()=>{},{})}catch(e){return e.name}",
  "function F(){}const method=Object.getPrototypeOf(F)[Symbol.hasInstance];F.prototype=null;try{return method.call(F,{})}catch(e){return e.name}",
  "function F(){}const method=Object.getPrototypeOf(F)[Symbol.hasInstance];F.prototype=null;return method.call(F,7)",
  "function F(){}const method=Object.getPrototypeOf(F)[Symbol.hasInstance];const value=new F();Object.setPrototypeOf(F,null);return [method.call(F,value),value instanceof F]",
  "function F(){}const method=Object.getPrototypeOf(F)[Symbol.hasInstance];const value=new F();Object.setPrototypeOf(value,null);return method.call(F,value)",
  "function F(){}const method=Object.getPrototypeOf(F)[Symbol.hasInstance];const bound=F.bind(null).bind(null);return [method.call(bound,new F()),method.call(bound,7)]",
  "class F{}class Sub extends F{static [Symbol.hasInstance](value){return super[Symbol.hasInstance](value)}}return new Sub() instanceof Sub",
  "function F(){}try{F[Symbol.hasInstance]=()=>true}catch(e){return e.name}",
  "const prototype=Object.getPrototypeOf(()=>{});try{delete prototype[Symbol.hasInstance]}catch(e){return e.name}",
  "const method=Object.getPrototypeOf(()=>{})[Symbol.hasInstance];try{new method()}catch(e){return e.name}",
  "function* f(){}const method=Object.getPrototypeOf(()=>{})[Symbol.hasInstance];return method.call(f,f())",
  "const method=Object.getPrototypeOf(()=>{})[Symbol.hasInstance];return [method.call(Array,[]),method.call(Object,{}),method.call(Map,new Map()),method.call(Date,new Date())]"
])("exposes the ordinary has-instance intrinsic: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){'use strict';${source}})()`)});
});

it("accounts for metadata attached to the symbol-named intrinsic", async () => {
  await expect(run("Object.getPrototypeOf(()=>{})[Symbol.hasInstance].extra='x'.repeat(10000);return 1",{
    budget:new Budget({dataSize:5000})
  })).rejects.toMatchObject({budget:"dataSize"});
});

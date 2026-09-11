import {expect,it} from "vitest";
import {analyzeModule} from "../analysis.js";
import {LexicalFrame} from "./lexical-frame.js";
import {FrameLocalsMapping} from "./frame-locals-mapping.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

type Key=string|number|{name:string;hash?:bigint};
function fixture(){
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),scope=analyzeModule("def f(x,y):return x+y").scopes.children[0];
  const frame=new LexicalFrame<unknown>(scope,{globals:new Map(),builtins:new Map()},meter),events:string[]=[];
  const operations={name:(name:string):Key=>name,hash(key:Key){events.push("hash");return typeof key==="object"?key.hash??1n:1n;},equal(left:Key,right:Key){events.push("equal");return left===(typeof right==="object"?right.name:right);}};
  const mapping=new FrameLocalsMapping(frame.reflectLocals(),operations,meter);events.length=0;
  return {meter,frame,mapping,operations,events};
}
it("routes local keys to slots and arbitrary keys to ordered extra storage",()=>{
  const {frame,mapping}=fixture();mapping.set("extra",3);mapping.set(7,4);mapping.set("y",2);mapping.set("x",1);
  expect(frame.load("x")).toBe(1);expect(mapping.entries()).toEqual([["x",1],["y",2],["extra",3],[7,4]]);expect(mapping.size).toBe(4);
  const snapshot=mapping.entries();mapping.set("extra",5);expect(snapshot[2]).toEqual(["extra",3]);expect(mapping.delete(7)).toBe(true);expect(mapping.delete(7)).toBe(false);
});
it("matches hashable nonstring aliases against local slot names",()=>{
  const {frame,mapping}=fixture(),alias={name:"x"};mapping.set(alias,7);expect(frame.load("x")).toBe(7);expect(mapping.lookup(alias)).toEqual({value:7});
  expect(mapping.entries()).toEqual([["x",7]]);expect(()=>mapping.delete(alias)).toThrow("cannot remove local variables from FrameLocalsProxy");
});
it("requires matching hashes before slot equality",()=>{
  const {frame,mapping}=fixture(),alias={name:"x",hash:2n};frame.store("x",1);mapping.set(alias,2);
  expect(frame.load("x")).toBe(1);expect(mapping.lookup(alias)).toEqual({value:2});expect(mapping.entries()).toEqual([["x",1],[alias,2]]);
});
it("hashes identity matches but does not compare other slot names",()=>{
  const {mapping,events}=fixture();mapping.set("x",1);expect(events).toEqual(["hash"]);
});
it("keeps unbound slots absent on reads and undeletable on writes",()=>{
  const {mapping}=fixture();expect(mapping.lookup("x")).toBeUndefined();expect(mapping.entries()).toEqual([]);expect(mapping.size).toBe(0);
  expect(()=>mapping.delete("x")).toThrow("cannot remove local variables from FrameLocalsProxy");mapping.set("x",undefined);expect(mapping.lookup("x")).toEqual({value:undefined});
});
it("reads slot contents after equality callbacks mutate them",()=>{
  const {frame,mapping,operations}=fixture();frame.store("x",1);operations.equal=(left,right)=>{frame.store("x",9);return left===(typeof right==="object"?right.name:right);};
  expect(mapping.lookup({name:"x"})).toEqual({value:9});
});
it("skips equal unbound names on reads but chooses them for writes",()=>{
  const {frame,mapping,operations}=fixture();frame.store("y",2);operations.equal=()=>true;
  const alias={name:"anything"};expect(mapping.lookup(alias)).toEqual({value:2});mapping.set(alias,7);
  expect(frame.load("x")).toBe(7);expect(frame.load("y")).toBe(2);
});
it("preserves the original extra key and its insertion position on overwrite",()=>{
  const {mapping}=fixture(),key={name:"extra"};mapping.set("extra",1);mapping.set(3,2);mapping.set(key,7);
  expect(mapping.entries()).toEqual([["extra",7],[3,2]]);
});
it.each(["hash","equal"] as const)("preserves %s errors before publishing a write",name=>{
  const {frame,mapping,operations}=fixture(),failure=Error("key failure");frame.store("x",1);operations[name]=()=>{throw failure;};
  expect(()=>mapping.set({name:"x"},2)).toThrow(failure);expect(frame.load("x")).toBe(1);
});
it.each(["hash","equal"] as const)("does not let %s failures mask cancellation",name=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}),scope=analyzeModule("def f(x):return x").scopes.children[0];
  const frame=new LexicalFrame(scope,{globals:new Map(),builtins:new Map()},meter);
  const operations={name:(name:string):Key=>name,hash:(_key:Key)=>1n,equal:(_a:Key,_b:Key)=>true};
  const mapping=new FrameLocalsMapping(frame.reflectLocals(),operations,meter);operations[name]=()=>{controller.abort();throw Error("callback failed");};
  expect(()=>mapping.set({name:"x"},2)).toThrow(ExecutionLimitError);
});

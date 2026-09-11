import { expect, it } from "vitest";
import { run } from "../run.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { isSandboxClosure } from "./values.js";
import { createNumericTypedArrayGlobal } from "./globals/numeric-typed-array.js";
import { Budget } from "./budget.js";
import { registerBuiltinIdentities } from "./intrinsics.js";
import { getSandboxDataProperty } from "./object-model.js";

it.each([
  {source:"const value=new Float32Array([2]);Object.defineProperty(value,'extra',{get(){return this[0]+7}});return ()=>value.extra",expected:9},
  {source:"class Custom extends Float32Array{field=7;length=0}const value=new Custom([2,4]);return ()=>[value.field,value.length,value.join(',')]",expected:[7,0,"2,4"]},
  {source:"class Custom extends Float32Array{get answer(){return this[0]+7}}const value=new Custom([2]);return ()=>[value instanceof Custom,Object.getPrototypeOf(value)===Custom.prototype,value.answer]",expected:[true,true,9]},
  {source:"const value=new Float32Array([2]);Object.setPrototypeOf(value,null);return ()=>[Object.getPrototypeOf(value)===null,value[0],value.length]",expected:[true,2,undefined]},
  {source:"const value=new Float32Array([2]);const key=Symbol('tag');value.self=value;value[key]=7;return ()=>[value.self===value,value[key],value[0]]",expected:[true,7,2]},
  {source:"const value=new Float32Array([2,4]);const view=value.subarray(1);return ()=>{value[1]=7;return [view[0],value[0]]}",expected:[7,2]},
  {source:"const value=new Float32Array([2]);value[Symbol.iterator]=function*(){yield this[0]+7};return ()=>Array.from(value)",expected:[9]}
])("preserves typed storage and prototype behavior across portable snapshots: $source", async ({source,expected}) => {
  const original=await run(source);
  let read=original.returnValue;
  for(let round=0;round<2;round++) {
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read:read as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const result=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("read");
    if(!result.found||!isSandboxClosure(result.value))throw new Error("Missing restored reader");
    expect(await result.value.call([])).toEqual(expected);
    read=result.value;
  }
});

it.each(["numeric-metadata", "scope-prototype", "mixed-entries", "bad-extensibility"])("rejects malformed typed-array state: %s", async mutation => {
  const source="const value=new Float32Array([2]);value.read=()=>value;return value";
  const original=await run(source);
  const saved=JSON.parse(JSON.stringify(serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{value:original.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}})));
  const entries=Object.entries(saved.heap) as Array<[string,Record<string,any>]>;
  const value=entries.find(([,node])=>node.kind==="float32array")![1];
  if(mutation==="numeric-metadata")value.state.properties.properties.push(["0",{kind:"data",value:9,writable:true,enumerable:true,configurable:true}]);
  if(mutation==="scope-prototype")value.state.prototype={kind:"ref",id:Number(entries.find(([,node])=>node.kind==="scope-frame")![0])};
  if(mutation==="mixed-entries")value.entries.extra=7;
  if(mutation==="bad-extensibility")value.state.properties.extensible="yes";
  expect(()=>restore(saved,{source})).toThrow();
});

it("restores the older Float32Array constructor property shape", () => {
  const source="return 1";
  const budget=new Budget();
  const constructor=createNumericTypedArrayGlobal(budget);
  registerBuiltinIdentities(budget,{Float32Array:constructor});
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{constructor}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const result=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("constructor");
  if(!result.found)throw new Error("Missing legacy constructor");
  expect(getSandboxDataProperty(result.value,"prototype")).toBeUndefined();
  expect(getSandboxDataProperty(result.value,"BYTES_PER_ELEMENT")).toBe(4);
});

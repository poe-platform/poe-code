import { expect, it } from "vitest";
import { run } from "../run.js";
import { isSandboxClosure, type SandboxValue } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it("reports false for attached empty, fixed and resizable buffers", async () => {
  expect(await run('return [new ArrayBuffer(0).detached,new ArrayBuffer(4).detached,new ArrayBuffer(0,{maxByteLength:8}).detached]')).toMatchObject({ok:true,returnValue:[false,false,false]});
});

it("exposes the standard getter descriptor", async () => {
  expect(await run('const descriptor=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,"detached");return [descriptor.get.name,descriptor.get.length,descriptor.set,descriptor.enumerable,descriptor.configurable]')).toMatchObject({ok:true,returnValue:["get detached",0,undefined,false,true]});
});

it.each([0,4,12000])("distinguishes detached storage from attached storage of length %s", async length => {
  const getter=(await run('return Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,"detached").get')).returnValue;
  if(!isSandboxClosure(getter))throw new Error("Missing detached getter");
  const buffer=new ArrayBuffer(length);
  expect(await getter.call([],{stack:[],thisValue:buffer})).toBe(false);
  structuredClone(buffer,{transfer:[buffer]});
  expect(await getter.call([],{stack:[],thisValue:buffer})).toBe(true);
  expect(()=>getter.call([],{stack:[],thisValue:[]})).toThrow(TypeError);
  expect(()=>getter.call([],{stack:[],thisValue:new SharedArrayBuffer(0) as unknown as SandboxValue})).toThrow(TypeError);
});

it("reads internal state without consulting shadowed properties", async () => {
  expect(await run('const value=new ArrayBuffer(0);Object.defineProperty(value,"byteLength",{get(){throw 7}});Object.defineProperty(value,"constructor",{get(){throw 8}});return value.detached')).toMatchObject({ok:true,returnValue:false});
});

it("inherits the getter on subclasses and rejects assignment", async () => {
  expect(await run('class Buffer extends ArrayBuffer{};const value=new Buffer(4);let error;try{value.detached=true}catch(caught){error=caught.name};return [value.detached,error]')).toMatchObject({ok:true,returnValue:[false,"TypeError"]});
});

it("does not mistake resizing to zero for detachment", async () => {
  expect(await run('const value=new ArrayBuffer(4,{maxByteLength:8});value.resize(0);const empty=value.detached;value.resize(8);return [empty,value.detached]')).toMatchObject({ok:true,returnValue:[false,false]});
});

it("preserves the intrinsic getter through two snapshot round-trips", async () => {
  const source='const buffer=new ArrayBuffer(4);return ()=>buffer.detached';
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const restored=restore(saved,{source}).currentScope.lookup("read");
    if(!restored.found||!isSandboxClosure(restored.value))throw new Error("Missing restored reader");
    expect(await restored.value.call([])).toBe(false);
    read=restored.value;
  }
});

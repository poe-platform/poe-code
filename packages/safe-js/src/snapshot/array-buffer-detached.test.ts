import { expect, it } from "vitest";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { encodeReplayData, decodeReplayData } from "./replay-data.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";
import { arrayBufferDetached, arrayBufferOptions } from "../interp/array-buffer.js";
import { run } from "../run.js";
import { isSandboxClosure } from "../interp/values.js";
import { decodeArrayBufferStorage } from "./array-buffer.js";
import { Budget } from "../interp/budget.js";
import { dump } from "../dump.js";
import { restore as restoreRun } from "../restore.js";

it.each(["snapshot","replay"])("preserves detached storage and aliases through %s", route => {
  for(const resizable of [false,true]){
    const buffer=Reflect.construct(ArrayBuffer,[4,resizable?{maxByteLength:16}:undefined]) as ArrayBuffer;
    structuredClone(buffer,{transfer:[buffer]});
    const values=[buffer,buffer,new ArrayBuffer(0)];
    const source="return 0";
    let restored: unknown;
    if(route==="snapshot"){
      const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{values}}],callStack:[],pendingPromises:[],moduleBindings:{}});
      const binding=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("values");
      restored=binding.found?binding.value:undefined;
    }else restored=decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(values))));
    if(!Array.isArray(restored))throw new Error("Missing restored buffers");
    expect(restored[0]).toBe(restored[1]);
    expect(restored[0]).not.toBe(buffer);
    expect(arrayBufferDetached(restored[0])).toBe(true);
    expect(arrayBufferDetached(restored[2])).toBe(false);
    expect(arrayBufferOptions(restored[0])!==undefined).toBe(resizable);
  }
});

it("can record detached buffers in diagnostic dumps", () => {
  const buffer=new ArrayBuffer(0);
  structuredClone(buffer,{transfer:[buffer]});
  const saved=JSON.parse(serializeSafeJSSnapshot({sourceHash:"detached",values:[buffer]}));
  expect(Object.values(saved.heap)).toEqual(expect.arrayContaining([expect.objectContaining({kind:"arraybuffer",detached:true,bytes:[]})]));
});

it.each(["snapshot","replay"])("preserves detached views and metadata cycles through repeated %s round-trips", route => {
  for(const resizable of [false,true])for(const bufferFirst of [false,true]){
    const buffer=Reflect.construct(ArrayBuffer,[12,resizable?{maxByteLength:16}:undefined]) as ArrayBuffer;
    const view=new Float32Array(buffer,4,2);
    const other=new Float32Array(buffer);
    Object.defineProperty(buffer,"owner",{value:view,enumerable:true});
    Object.defineProperty(view,"parent",{value:buffer,enumerable:true});
    structuredClone(buffer,{transfer:[buffer]});
    let values: unknown[]=bufferFirst?[buffer,view,other]:[view,buffer,other];
    for(let round=0;round<3;round++){
      const source="return 0";
      if(route==="snapshot"){
        const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{values}}],callStack:[],pendingPromises:[],moduleBindings:{}});
        const binding=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("values");
        if(!binding.found||!Array.isArray(binding.value))throw new Error("Missing restored views");
        values=binding.value;
      }else values=decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(values)))) as unknown[];
      const restoredBuffer=values[bufferFirst?0:1] as ArrayBuffer;
      const restoredView=values[bufferFirst?1:0] as Float32Array;
      expect(restoredView.buffer).toBe(restoredBuffer);
      expect((values[2] as Float32Array).buffer).toBe(restoredBuffer);
      expect(arrayBufferDetached(restoredBuffer)).toBe(true);
      expect(arrayBufferOptions(restoredBuffer)!==undefined).toBe(resizable);
      expect(restoredView.length).toBe(0);
      expect(restoredView.byteOffset).toBe(0);
      expect(()=>restoredView.values()).toThrow(TypeError);
      expect(Object.getOwnPropertyDescriptor(restoredBuffer,"owner")?.value).toBe(restoredView);
      expect(Object.getOwnPropertyDescriptor(restoredView,"parent")?.value).toBe(restoredBuffer);
    }
  }
});

it("restores a guest closure retaining a detached source, view and transferred result", async () => {
  const source='const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);view.set([1,2]);const result=buffer.transfer();return ()=>[buffer.detached,buffer.resizable,view.length,view.buffer===buffer,Array.from(new Float32Array(result))]';
  let read=(await run(source)).returnValue;
  for(let round=0;round<2;round++){
    const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const binding=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("read");
    if(!binding.found||!isSandboxClosure(binding.value))throw new Error("Missing restored closure");
    expect(await binding.value.call([])).toEqual([true,true,0,true,[1,2]]);
    read=binding.value;
  }
});

it.each([
  {bytes:[],detached:false},
  {bytes:[],detached:"true"},
  {bytes:[1],detached:true},
  {bytes:[],detached:true,maxByteLength:1},
  {buffer:{kind:"ref",id:1},detached:true}
])("rejects malformed detached payload %j", payload => {
  expect(()=>decodeArrayBufferStorage(payload,()=>new ArrayBuffer(0))).toThrow(TypeError);
});

it("charges restoration detachment work to the budget", () => {
  expect(()=>decodeArrayBufferStorage({bytes:[],detached:true},()=>undefined,new Budget({maxSteps:0})))
    .toThrow(expect.objectContaining({code:"budgetExceeded",budget:"steps"}));
});

it("keeps legacy empty payloads attached", () => {
  expect(arrayBufferDetached(decodeArrayBufferStorage({bytes:[]},()=>undefined))).toBe(false);
});

it("round-trips detached guest state through the public run, dump and restore APIs", async () => {
  const source = "const buffer=new ArrayBuffer(8,{maxByteLength:16});const view=new Float32Array(buffer);view.set([3,4]);const copied=buffer.transfer();await 0;return [buffer.detached,buffer.resizable,view.buffer===buffer,view.length,Array.from(new Float32Array(copied))]";
  let result = await run(source);
  for (let round = 0; round < 2; round++) {
    expect(result).toMatchObject({ok:true,returnValue:[true,true,true,0,[3,4]]});
    const snapshot = restoreRun(JSON.parse(await dump(result)), {source});
    result = await run(source, {snapshot});
  }
  expect(result).toMatchObject({ok:true,returnValue:[true,true,true,0,[3,4]]});
});

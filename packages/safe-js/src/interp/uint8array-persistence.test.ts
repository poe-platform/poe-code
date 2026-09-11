import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreRun } from "../restore.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { encodeReplayData, decodeReplayData } from "../snapshot/replay-data.js";
import { typedArrayViewLayouts } from "./typed-array.js";
import { arrayBufferDetached } from "./array-buffer.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { createNumericTypedArrayGlobal } from "./globals/numeric-typed-array.js";

it.each(["snapshot","replay"])("preserves resizable and detached mixed views in %s", route => {
  for (const detached of [false,true]) {
    const buffer = Reflect.construct(ArrayBuffer,[8,{maxByteLength:16}]) as ArrayBuffer;
    const bytes = new Uint8Array(buffer,1);
    const floats = new Float32Array(buffer);
    typedArrayViewLayouts.set(bytes,{byteOffset:1});
    typedArrayViewLayouts.set(floats,{byteOffset:0});
    bytes[0] = 7;
    if (detached) structuredClone(buffer,{transfer:[buffer]});
    let graph = {buffer,bytes,floats,alias:bytes};
    for (let round=0;round<2;round++) {
      if (route === "replay") graph = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(graph)))) as typeof graph;
      else {
        const source = "return 0";
        const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{graph}}],callStack:[],pendingPromises:[],moduleBindings:{}});
        const binding = restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("graph");
        if (!binding.found) throw new Error("Missing restored graph");
        graph = binding.value as typeof graph;
      }
      expect(graph.bytes).toBeInstanceOf(Uint8Array);
      expect(graph.floats).toBeInstanceOf(Float32Array);
      expect(graph.bytes).toBe(graph.alias);
      expect(graph.bytes.buffer).toBe(graph.buffer);
      expect(graph.floats.buffer).toBe(graph.buffer);
      expect(arrayBufferDetached(graph.buffer)).toBe(detached);
      expect(graph.bytes.length).toBe(detached?0:7);
      if (!detached) expect(graph.bytes[0]).toBe(7);
      else expect(()=>graph.bytes.values()).toThrow(TypeError);
    }
  }
});

it("restores a completed public run containing Uint8Array state", async () => {
  const source = "const buffer=new ArrayBuffer(8);const bytes=new Uint8Array(buffer,1,3);bytes.set([1,2,255]);await 0;return [Array.from(bytes),bytes.buffer===buffer,bytes instanceof Uint8Array]";
  const result = await run(source);
  const snapshot = restoreRun(JSON.parse(await dump(result)),{source});
  expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[[1,2,255],true,true]});
});

it("replays a typed host outcome without repeating its completed effect", async () => {
  let calls = 0;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve=>{release=resolve;});
  const paused = new Promise<void>(resolve=>{entered=resolve;});
  let waits = 0;
  const produce = declareHostOperation(()=>{
    calls++;
    const buffer = new ArrayBuffer(8);
    return {bytes:new Uint8Array(buffer,1,3),floats:new Float32Array(buffer)};
  },"read-side-effect");
  const wait = declareHostOperation(async()=>{
    entered();
    if (waits++===0) await gate;
  },"re-issue");
  const source = "const graph=await produce();await wait();graph.bytes[0]=255;return [graph.bytes instanceof Uint8Array,graph.bytes.buffer===graph.floats.buffer,Array.from(graph.bytes)]";
  const execution = run(source,{bindings:{produce,wait}});
  try {
    await paused;
    await new Promise<void>(resolve=>setImmediate(resolve));
    const snapshot = restoreRun(JSON.parse(await dump(execution,{mode:"replay"})),{source});
    release();
    expect(await execution).toMatchObject({ok:true,returnValue:[true,true,[255,0,0]]});
    expect(await run(source,{snapshot,bindings:{produce,wait}})).toMatchObject({ok:true,returnValue:[true,true,[255,0,0]]});
    expect(calls).toBe(1);
    expect(waits).toBe(2);
  } finally {
    release();
    await execution;
  }
});

it("bounds backing storage on narrow imported byte views", async () => {
  const value = new Uint8Array(new ArrayBuffer(400),0,1);
  await expect(run("return value.length",{bindings:{value},budget:new Budget({arrayLength:100})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"arrayLength"});
});

it("charges one byte per Uint8Array element rather than four", async () => {
  const bytes = createNumericTypedArrayGlobal(new Budget({dataSize:256}),false,Uint8Array);
  const result = await bytes.construct!([128]);
  expect(result).toBeInstanceOf(Uint8Array);
  expect((result as Uint8Array).byteLength).toBe(128);
  const floats = createNumericTypedArrayGlobal(new Budget({dataSize:256}),false,Float32Array);
  expect(()=>floats.construct!([128])).toThrow(expect.objectContaining({code:"budgetExceeded",budget:"dataSize"}));
});

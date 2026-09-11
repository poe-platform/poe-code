import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { deepCopyToSandbox, deepCopyFromSandbox, isSandboxClosure } from "./values.js";
import { encodeReplayData, decodeReplayData } from "../snapshot/replay-data.js";
import { serialize } from "../snapshot/serialize.js";
import { restore as restoreRuntime } from "../snapshot/restore.js";
import { Float16Array } from "./float16-array.js";
import { Budget } from "./budget.js";
import { createNumericTypedArrayGlobal } from "./globals/numeric-typed-array.js";

it("supports Float16Array rounding, signed zero and overflow", async () => {
  const source = "const a=new Float16Array([1.1,-0,65520]);return [a.length,a[0],Object.is(a[1],-0),a[2]]";
  // Verified with native Node 24.14.0; the maintained test host may lack Float16Array.
  expect(await run(source)).toMatchObject({ok:true,returnValue:[3,1.099609375,true,Infinity]});
});

it("preserves Float16 methods and backing aliases in public snapshots", async () => {
  const source = "const a=new Float16Array([1.5,2.5]);const b=a.subarray(1);const map=a.map;await 0;return [a instanceof Float16Array,a.buffer===b.buffer,map===a.map,Array.from(b.map(x=>x+1))]";
  const result = await run(source);
  expect(result).toMatchObject({ok:true,returnValue:[true,true,true,[3.5]]});
  const snapshot = restore(JSON.parse(await dump(result)), {source});
  expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
});

it("preserves Float16 host-copy and replay bytes and aliases", () => {
  const a = new Float16Array([1.5,2.5]);
  const graph = {a,alias:a,buffer:a.buffer,bytes:new Uint8Array(a.buffer)};
  const copied = deepCopyToSandbox(graph);
  for (const restored of [deepCopyFromSandbox(copied),decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(copied))))] as Array<typeof graph>) {
    expect(restored.a).toBeInstanceOf(Float16Array);
    expect(Array.from(restored.a)).toEqual([1.5,2.5]);
    expect(restored.a).toBe(restored.alias);
    expect(restored.a.buffer).toBe(restored.buffer);
    expect(restored.bytes.buffer).toBe(restored.buffer);
    expect(restored.buffer).not.toBe(graph.buffer);
  }
});

it("restores Float16 out-of-bounds fixed and tracking views", async () => {
  const source = "const buffer=new ArrayBuffer(4,{maxByteLength:8});const a=new Float16Array(buffer,2,1);const b=new Float16Array(buffer,2);buffer.resize(0);return ()=>{buffer.resize(8);a[0]=7.5;return [a.length,b.length,b[0],a.buffer===b.buffer]}";
  const result = await run(source);
  expect(result.ok).toBe(true);
  const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{read:result.returnValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const binding = restoreRuntime(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("read");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing restored closure");
  expect(await binding.value.call([])).toEqual([1,3,7.5,true]);
});

it("charges Float16 backing bytes before allocation", () => {
  const allowed = createNumericTypedArrayGlobal(new Budget({dataSize:33}),false,Float16Array);
  expect((allowed.construct!([16]) as InstanceType<typeof Float16Array>).byteLength).toBe(32);
  const denied = createNumericTypedArrayGlobal(new Budget({dataSize:32}),false,Float16Array);
  expect(()=>denied.construct!([16])).toThrow(expect.objectContaining({code:"budgetExceeded",budget:"dataSize"}));
});

it.each([
  ["const a=new Float16Array([1,2]);a[Symbol.iterator]=()=>{throw 1};return Array.from(new Float32Array(a))", [1,2]],
  ["const a=new Float16Array([1,2,3]);a.set(a.subarray(0,2),1);return Array.from(a)", [1,1,2]],
  ["const a=new Float16Array([1,2]);Object.defineProperty(a,'length',{value:0});const b=new Float32Array(2);b.set(a);return Array.from(b)", [1,2]],
  ["try{new BigInt64Array(new Float16Array(0));return false}catch(e){return e instanceof TypeError}", true],
  ["try{new Float16Array(0).set(new BigInt64Array(0));return false}catch(e){return e instanceof TypeError}", true],
  ["const a=new Float16Array([3,1,2]);return [Array.from(a.map(x=>x+0.5)),Array.from(a.filter(x=>x>1)),Array.from(a.toSorted())]", [[3.5,1.5,2.5],[3,2],[1,2,3]]],
  ["const b=new ArrayBuffer(4);new Uint16Array(b).set([0x7c01,0xfe03]);const a=new Float16Array(b);return Array.from(new Uint16Array(new Float16Array(a).buffer))", [0x7c01,0xfe03]],
  ["return [Array.from(Float16Array.of(1.5,2.5)),Array.from(Float16Array.from([1,2],x=>x+0.5))]", [[1.5,2.5],[1.5,2.5]]],
  ["const a=new Float16Array(2);a[0]='1.5';Object.defineProperty(a,'1',{value:true});return Array.from(a)", [1.5,1]],
  ["const a=new Float16Array([1.5,2.5]);const copy=structuredClone({a,buffer:a.buffer});return [copy.a instanceof Float16Array,copy.a.buffer===copy.buffer,Array.from(copy.a)]", [true,true,[1.5,2.5]]],
  ["const a=new Float16Array([1]);a.buffer.transfer();const errors=[];for(const f of [()=>a.slice(),()=>a.set([]),()=>new Float16Array(a),()=>a.values()]){try{f();errors.push(false)}catch(e){errors.push(e.name)}}return [a.length,errors]", [0,["TypeError","TypeError","TypeError","TypeError"]]],
  ["const b=new ArrayBuffer(4,{maxByteLength:8});const a=new Float16Array(b);a[0]=1.5;b.resize(8);a[3]=2.5;return Array.from(a)", [1.5,0,0,2.5]],
  ["const a=new Float16Array([1,2,3,4]);a.copyWithin(1,2);a.reverse();a.fill('9',1,3);return Array.from(a)", [4,9,9,1]],
  ["const a=new Float16Array([1,2]);const errors=[];for(const f of [()=>a.fill(1n),()=>a.with(0,1n),()=>a.set([1n]),()=>a.map(()=>1n),()=>Float16Array.of(1n),()=>Float16Array.from([1n])]){try{f();errors.push(false)}catch(e){errors.push(e.name)}}return errors", ["TypeError","TypeError","TypeError","TypeError","TypeError","TypeError"]],
  ["const b=new ArrayBuffer(8);const source=new Float32Array(b);source.set([1.5,2.5]);const target=new Float16Array(b);target.set(source,1);return Array.from(target.slice(1,3))", [1.5,2.5]],
] as const)("preserves native Float16 typed-array semantics: %s", async (source, returnValue) => {
  expect(await run(source)).toMatchObject({ok:true,returnValue});
});

it("exposes Float16Array typed storage and shared backing bytes", async () => {
  const source = "const a=new Float16Array([1.5,2.5]);return [ArrayBuffer.isView(a),a instanceof Float16Array,a.BYTES_PER_ELEMENT,a.byteLength,Array.from(new Uint16Array(a.buffer))]";
  expect(await run(source)).toMatchObject({ok:true,returnValue:[true,true,2,4,[0x3e00,0x4100]]});
});

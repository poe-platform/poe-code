import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { deepCopyFromSandbox, deepCopyToSandbox, isSandboxClosure, measureSandboxData } from "./values.js";
import { Budget } from "./budget.js";
import { encodeReplayData, decodeReplayData } from "../snapshot/replay-data.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

// ECMA-262 edition 16: NumericToRawBytes, SetValueInBuffer, and typed array
// algorithms. Literal controls intentionally do not use a native numeric oracle.
const kinds = [
  ["Int8Array", 1], ["Uint8Array", 1], ["Uint8ClampedArray", 1],
  ["Int16Array", 2], ["Uint16Array", 2], ["Int32Array", 4],
  ["Uint32Array", 4], ["Float16Array", 2], ["Float32Array", 4],
  ["Float64Array", 8], ["BigInt64Array", 8], ["BigUint64Array", 8]
] as const;

it.each(kinds)("qualifies %s overlap, iteration and resize recovery", async (kind, width) => {
  const big = kind.startsWith("Big");
  const source = `
    const b = new ArrayBuffer(${width * 4}, {maxByteLength:${width * 6}});
    const a = new ${kind}(b);
    const fixed = new ${kind}(b, ${width}, 2);
    a.set(${big ? "[1n,2n,3n,4n]" : "[1,2,3,4]"});
    a.set(a.subarray(0,3),1);
    const overlap = Array.from(a, Number);
    const iter = a.values();
    const first = Number(iter.next().value);
    b.resize(${width});
    const short = [a.length, fixed.length, fixed.byteOffset, iter.next().done];
    b.resize(${width * 6});
    return [overlap, first, short, Array.from(a, Number), fixed.length, fixed.buffer===b];
  `;
  expect(await run(source)).toMatchObject({ok:true,returnValue:[
    [1,1,2,3],1,[1,0,0,true],[1,0,0,0,0,0],2,true
  ]});
});

it("qualifies explicit endian bytes and integer conversion boundaries", async () => {
  expect(await run(`
    const b=new ArrayBuffer(16); const d=new DataView(b);
    d.setUint32(0, 0x12345678); d.setUint32(4, 0x12345678, true);
    d.setInt8(8,257); d.setUint8(9,-1); d.setInt16(10,65535);
    d.setUint32(12,4294967297);
    return [Array.from(new Uint8Array(b)),d.getInt16(10),d.getUint32(12)];
  `)).toMatchObject({ok:true,returnValue:[
    [18,52,86,120,120,86,52,18,1,255,255,255,0,0,0,1],-1,1
  ]});
});

it("qualifies Float16 ties, subnormals, signed zero and overflow as raw bits", async () => {
  expect(await run(`
    const b=new ArrayBuffer(16);const d=new DataView(b);
    const values=[1+2**-11,1+3*2**-11,2**-25,3*2**-25,-0,65520,Infinity,-Infinity];
    values.forEach((v,i)=>d.setFloat16(i*2,v,false));
    return Array.from(new Uint8Array(b));
  `)).toMatchObject({ok:true,returnValue:[
    60,0,60,2,0,0,0,2,128,0,124,0,124,0,252,0
  ]});
});

it("qualifies BigInt modulo boundaries and rejects Number conversion", async () => {
  expect(await run(`
    const a=new BigInt64Array([2n**63n,2n**64n+1n]);
    const u=new BigUint64Array([-1n]);let error;
    try { a[0]=1; } catch(e) { error=e.name; }
    return [String(a[0]),String(a[1]),String(u[0]),error];
  `)).toMatchObject({ok:true,returnValue:["-9223372036854775808","1","18446744073709551615","TypeError"]});
});

it.each(["Float16Array","Float32Array","Float64Array"])("qualifies %s numeric sort and NaN", async kind => {
  expect(await run(`
    const a=new ${kind}([NaN,0,-0,Infinity,-Infinity,1]);a.sort();
    return [a[0],Object.is(a[1],-0),Object.is(a[2],0),a[3],a[4],Number.isNaN(a[5])];
  `)).toMatchObject({ok:true,returnValue:[-Infinity,true,true,1,Infinity,true]});
});

it("revalidates DataView after detachment during value conversion", async () => {
  expect(await run(`
    const b=new ArrayBuffer(4);const d=new DataView(b);let error;
    try {d.setUint32(0,{valueOf(){b.transfer();return 1}})}catch(e){error=e.name}
    return [error,b.detached];
  `)).toMatchObject({ok:true,returnValue:["TypeError",true]});
});

it.each(kinds)("preserves %s exact bytes and aliases across admission and recovery", async (kind, width) => {
  const result=await run(`const b=new ArrayBuffer(${width*4});
    const bytes=new Uint8Array(b);bytes.fill(165);
    const view=new ${kind}(b,${width},2);
    return {b,bytes,view,alias:view};`);
  expect(result.ok).toBe(true);
  const admitted=deepCopyToSandbox(result.returnValue);
  const source="return 0";
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{graph:admitted}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const binding=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("graph");
  expect(binding.found).toBe(true);
  if(!binding.found) throw new Error("Missing graph");
  for(const graph of [deepCopyFromSandbox(admitted),decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(admitted)))),binding.value]) {
    const value=graph as {b:ArrayBuffer;bytes:Uint8Array;view:Uint8Array;alias:Uint8Array};
    expect(value.view).toBe(value.alias);
    expect(value.view.buffer).toBe(value.b);
    expect(value.bytes.buffer).toBe(value.b);
    expect(value.view.byteOffset).toBe(width);
    expect(value.view.byteLength).toBe(width*2);
    expect(Array.from(value.bytes)).toEqual(Array(width*4).fill(165));
  }
});

it.each(kinds)("qualifies %s shared growth and structured-copy aliases", async (kind,width) => {
  expect(await run(`
    const b=new SharedArrayBuffer(${width*2},{maxByteLength:${width*4}});
    const a=new ${kind}(b);const fixed=new ${kind}(b,0,1);
    const c=structuredClone({b,a});
    new Uint8Array(c.b)[0]=37;
    b.grow(${width*4});
    return [a.length,fixed.length,c.a.length,c.a.buffer===c.b,c.b!==b,
      new Uint8Array(b)[0],Array.from(new Uint8Array(b).slice(${width*2}))];
  `)).toMatchObject({ok:true,returnValue:[4,1,4,true,true,37,Array(width*2).fill(0)]});
});

it.each(["transfer","transferToFixedLength"])("rolls back %s allocation failure before detaching", async methodName => {
  const budget=new Budget({dataSize:10000});
  const method=(await run(`return ArrayBuffer.prototype.${methodName}`,{budget})).returnValue;
  if(!isSandboxClosure(method)) throw new Error("Missing transfer intrinsic");
  const b=new ArrayBuffer(4);const bytes=new Uint8Array(b);bytes.set([18,52,86,120]);
  const retained=measureSandboxData(budget.retainedValues());
  const construct=Reflect.construct;
  const spy=vi.spyOn(Reflect,"construct").mockImplementation((target,args,newTarget)=>{
    if(target===ArrayBuffer) throw new RangeError("injected bounded allocation failure");
    return construct(target,args,newTarget??target);
  });
  try {
    await expect(method.call([8],{stack:[],thisValue:b})).rejects.toThrow("injected bounded allocation failure");
  } finally {spy.mockRestore();}
  expect(b.byteLength).toBe(4);
  expect(Array.from(bytes)).toEqual([18,52,86,120]);
  expect(measureSandboxData(budget.retainedValues())).toBe(retained);
  const copied=await method.call([8],{stack:[],thisValue:b}) as ArrayBuffer;
  expect(Array.from(new Uint8Array(copied))).toEqual([18,52,86,120,0,0,0,0]);
  expect(bytes.length).toBe(0);
});

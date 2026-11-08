import { expect, it } from "vitest";
import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";
import { isSandboxClosure } from "../values.js";
import { getSandboxPrototype } from "../object-model.js";
import { temporalInstantEpoch } from "../temporal-instant.js";

it.each([0,-1,1,-8640000000000000,8640000000000000])("converts Date milliseconds %s exactly", async milliseconds => {
  expect(await run(`return new Date(${milliseconds}).toTemporalInstant().epochNanoseconds`))
    .toMatchObject({ok:true,returnValue:BigInt(milliseconds)*1000000n});
});

it("uses the internal time without reading methods, arguments or species", async () => {
  expect(await run(`class Child extends Date{};const date=new Child(-1);
    date.getTime=date.valueOf=date.toString=()=>{throw 'coerced'};
    date.constructor={get [Symbol.species](){throw 'species'}};
    const original=Temporal.Instant;Temporal.Instant=function(){throw 'replaced'};
    const value=date.toTemporalInstant(new Proxy({},{get(){throw 'argument'}}));
    return [value.epochNanoseconds,Object.getPrototypeOf(value)===original.prototype]`))
    .toMatchObject({ok:true,returnValue:[-1000000n,true]});
});

it("rejects invalid Dates and non-Date receivers without coercion", async () => {
  expect(await run(`let invalid,receiver,proxy,reads=0;
    try{new Date(NaN).toTemporalInstant()}catch(error){invalid=error.name}
    try{Date.prototype.toTemporalInstant.call({valueOf(){reads++;return 0}})}catch(error){receiver=error.name}
    try{Date.prototype.toTemporalInstant.call(new Proxy(new Date(0),{get(){reads++;throw 'read'}}))}catch(error){proxy=error.name}
    return [invalid,receiver,proxy,reads]`))
    .toMatchObject({ok:true,returnValue:["RangeError","TypeError","TypeError",0]});
});

it("has standard method metadata and is not constructible", async () => {
  expect(await run(`const descriptor=Object.getOwnPropertyDescriptor(Date.prototype,'toTemporalInstant');
    const method=descriptor.value;let error;try{new method()}catch(e){error=e.name}
    return [method.name,method.length,descriptor.enumerable,descriptor.writable,descriptor.configurable,error]`))
    .toMatchObject({ok:true,returnValue:["toTemporalInstant",0,false,true,true,"TypeError"]});
});

it("replays the converted Instant", async () => {
  const source="const instant=new Date(-1).toTemporalInstant();await 0;return instant.toJSON()";
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:"1969-12-31T23:59:59.999Z"});
  expect(await run(source,{snapshot:JSON.parse(serializeSafeJSSnapshot(first.snapshot))}))
    .toMatchObject({ok:true,returnValue:"1969-12-31T23:59:59.999Z"});
});

it("uses the method's realm when called on a foreign Date through the SDK", async () => {
  const local=await run("return [Date.prototype.toTemporalInstant,Temporal.Instant.prototype]");
  const foreign=await run("return new Date(-1)");
  if (!local.ok || !foreign.ok || !Array.isArray(local.returnValue) || !isSandboxClosure(local.returnValue[0]))
    throw new Error("Expected Date conversion method");
  const value=await local.returnValue[0].call([],{stack:[],thisValue:foreign.returnValue});
  expect(temporalInstantEpoch(value)).toBe(-1000000n);
  expect(getSandboxPrototype(value as object)).toBe(local.returnValue[1]);
});

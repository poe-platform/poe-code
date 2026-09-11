import { expect, it } from "vitest";
import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { cloneSandboxValue, deepCopyFromSandbox } from "../values.js";
import { temporalPlainTimeFields } from "../temporal-plain-time.js";

it("constructs all six fields with the PlainTime brand and metadata", async () => {
  expect(await run(`const t=new Temporal.PlainTime(23,59,58,997,998,999);
    return [t.hour,t.minute,t.second,t.millisecond,t.microsecond,t.nanosecond,
      t instanceof Temporal.PlainTime,Object.prototype.toString.call(t),Temporal.PlainTime.length,
      Object.getOwnPropertyDescriptor(Temporal.PlainTime,'prototype').writable,
      Object.getPrototypeOf(Temporal.PlainTime.prototype)===Object.prototype]`))
    .toMatchObject({ok:true,returnValue:[23,59,58,997,998,999,true,"[object Temporal.PlainTime]",0,false,true]});
});

it("defaults undefined fields, truncates fractions and normalizes negative zero", async () => {
  expect(await run(`const t=new Temporal.PlainTime(undefined,-0,3.9,4.9,-0.5,6.9);
    return [t.hour,t.minute,t.second,t.millisecond,t.microsecond,t.nanosecond,Object.is(t.minute,-0),Object.is(t.microsecond,-0)]`))
    .toMatchObject({ok:true,returnValue:[0,0,3,4,0,6,false,false]});
});

it("converts all arguments in order before validating time ranges", async () => {
  expect(await run(`const events=[];const v=n=>({[Symbol.toPrimitive](hint){events.push([n,hint]);return n}});
    try{new Temporal.PlainTime(v(24),v(1),v(2),v(3),v(4),v(5))}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:[[24,"number"],[1,"number"],[2,"number"],[3,"number"],[4,"number"],[5,"number"],"RangeError"]});
});

it("requires new without converting arguments", async () => {
  expect(await run(`let reads=0;try{Temporal.PlainTime({valueOf(){reads++;return 1}})}catch(e){return [e.name,reads]}`))
    .toMatchObject({ok:true,returnValue:["TypeError",0]});
});

it.each([["Infinity","RangeError"],["NaN","RangeError"],["1n","TypeError"],["Symbol()","TypeError"]])(
  "rejects %s before later conversion", async (input,error) => {
    expect(await run(`let reads=0;try{new Temporal.PlainTime(${input},{valueOf(){reads++;return 0}})}catch(e){return [e.name,reads]}`))
      .toMatchObject({ok:true,returnValue:[error,0]});
  }
);

it("validates ranges before reading newTarget.prototype", async () => {
  expect(await run(`const events=[];const target=new Proxy(function(){},{get(t,k){events.push(k);return Reflect.get(t,k)}});
    try{Reflect.construct(Temporal.PlainTime,[24],target)}catch(e){return [e.name,events]}`))
    .toMatchObject({ok:true,returnValue:["RangeError",[]]});
});

it("supports subclasses and primitive newTarget prototype fallback", async () => {
  expect(await run(`class Derived extends Temporal.PlainTime{};const t=new Derived(23);
    function Target(){};Target.prototype=1;const other=Reflect.construct(Temporal.PlainTime,[],Target);
    return [t instanceof Derived,t.hour,Object.getPrototypeOf(other)===Temporal.PlainTime.prototype]`))
    .toMatchObject({ok:true,returnValue:[true,23,true]});
});

it("rejects unbranded getter receivers without proxy traps", async () => {
  expect(await run(`const events=[];const t=new Proxy(new Temporal.PlainTime(),{get(){events.push('get')}});
    for(const name of ['hour','minute','second','millisecond','microsecond','nanosecond']){
      try{Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype,name).get.call(t)}catch(e){events.push(e.name)}}return events`))
    .toMatchObject({ok:true,returnValue:Array(6).fill("TypeError")});
});

it("keeps public data descriptors distinct from private fields during copying", async () => {
  const result=await run(`const t=new Temporal.PlainTime(23);Object.defineProperty(t,'hour',{value:7});return t`);
  expect(result.ok).toBe(true);
  const copy=cloneSandboxValue(result.returnValue);
  expect(temporalPlainTimeFields(copy).hour).toBe(23);
  expect(Object.getOwnPropertyDescriptor(copy,"hour")?.value).toBe(7);
  const host=deepCopyFromSandbox(result.returnValue);
  expect(Object.getOwnPropertyDescriptor(host,"hour")?.value).toBe(7);
});

it("preserves a subclass and captured getter across completed replay", async () => {
  const source=`class Derived extends Temporal.PlainTime{};const t=new Derived(23,0,0,0,0,999);
    const get=Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype,'hour').get;
    await 0;return [t instanceof Derived,get.call(t),t.nanosecond]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[true,23,999]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

it("imports host bindings and replays host results without repeating calls", async () => {
  let calls=0;const load=()=>{calls++;return new TemporalBackend.PlainTime(23,59,58,997,998,999)};
  const source="const t=await load();return [input.hour,t.hour,t.nanosecond,t instanceof Temporal.PlainTime]";
  const first=await run(source,{bindings:{load,input:new TemporalBackend.PlainTime(1)}});
  expect(first).toMatchObject({ok:true,returnValue:[1,23,999,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first)),bindings:{load}}))
    .toMatchObject({ok:true,returnValue:first.returnValue});
  expect(calls).toBe(1);
});

it("rejects structured cloning before reading getters or detaching transfers", async () => {
  expect(await run(`let reads=0;const t=new Temporal.PlainTime();Object.defineProperty(t,'label',{enumerable:true,get(){reads++;return 7}});
    const buffer=new ArrayBuffer(4);let name;try{structuredClone({buffer,t},{transfer:[buffer]})}catch(e){name=e.name}
    return [name,reads,buffer.byteLength]`)).toMatchObject({ok:true,returnValue:["DataCloneError",0,4]});
});

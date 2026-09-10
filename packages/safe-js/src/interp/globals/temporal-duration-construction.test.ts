import { expect, it } from "vitest";
import { run } from "../../run.js";

it("constructs all fields with the Duration brand and metadata", async () => {
  expect(await run(`const d=new Temporal.Duration(1,2,3,4,5,6,7,8,9,10);
    return [d.years,d.months,d.weeks,d.days,d.hours,d.minutes,d.seconds,d.milliseconds,d.microseconds,d.nanoseconds,
      d.sign,d.blank,d instanceof Temporal.Duration,Object.prototype.toString.call(d),Temporal.Duration.length,
      Object.getOwnPropertyDescriptor(Temporal.Duration,'prototype').writable]`))
    .toMatchObject({ok:true,returnValue:[1,2,3,4,5,6,7,8,9,10,1,false,true,"[object Temporal.Duration]",0,false]});
});

it("defaults undefined fields and normalizes negative zero", async () => {
  expect(await run(`const d=new Temporal.Duration(undefined,-0);return [d.years,Object.is(d.months,-0),d.sign,d.blank]`))
    .toMatchObject({ok:true,returnValue:[0,false,0,true]});
});

it("coerces in parameter order and validates combined signs after all conversions", async () => {
  expect(await run(`const events=[];const v=n=>({[Symbol.toPrimitive](hint){events.push([n,hint]);return n}});
    try{new Temporal.Duration(v(1),v(-2),v(3))}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:[[1,"number"],[-2,"number"],[3,"number"],"RangeError"]});
});

it("requires new without converting arguments", async () => {
  expect(await run(`let reads=0;try{Temporal.Duration({valueOf(){reads++;return 1}})}catch(e){return [e.name,reads]}`))
    .toMatchObject({ok:true,returnValue:["TypeError",0]});
});

it.each([["0.5","RangeError"],["Infinity","RangeError"],["NaN","RangeError"],["1n","TypeError"],["Symbol()","TypeError"]])("rejects %s before later argument conversion", async (input,error) => {
  expect(await run(`let reads=0;try{new Temporal.Duration(${input},{valueOf(){reads++;return 0}})}catch(e){return [e.name,reads]}`))
    .toMatchObject({ok:true,returnValue:[error,0]});
});

it("validates bounds before reading the newTarget prototype", async () => {
  expect(await run(`const events=[];const target=new Proxy(function(){},{get(t,k){events.push(k);return Reflect.get(t,k)}});
    try{Reflect.construct(Temporal.Duration,[4294967296],target)}catch(e){return [e.name,events]}`))
    .toMatchObject({ok:true,returnValue:["RangeError",[]]});
});

it("supports subclasses and primitive newTarget prototype fallback", async () => {
  expect(await run(`class Derived extends Temporal.Duration{};const d=new Derived(0,0,0,-2);
    function Target(){};Target.prototype=1;const other=Reflect.construct(Temporal.Duration,[],Target);
    return [d instanceof Derived,d.days,d.sign,Object.getPrototypeOf(other)===Temporal.Duration.prototype]`))
    .toMatchObject({ok:true,returnValue:[true,-2,-1,true]});
});

it("rejects unbranded getter receivers without proxy traps", async () => {
  expect(await run(`const events=[];const d=new Proxy(new Temporal.Duration(),{get(){events.push('get')}});
    for(const name of ['years','sign','blank']){try{Object.getOwnPropertyDescriptor(Temporal.Duration.prototype,name).get.call(d)}catch(e){events.push(e.name)}}
    return events`)).toMatchObject({ok:true,returnValue:["TypeError","TypeError","TypeError"]});
});

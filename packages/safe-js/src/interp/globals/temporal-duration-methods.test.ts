import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([["'P1Y2M3DT4H5M6.007008009S'",[1,2,3,4,5,6,7,8,9]],
  ["{years:'1',months:2,days:3,hours:4,minutes:5,seconds:6,milliseconds:7,microseconds:8,nanoseconds:9}",[1,2,3,4,5,6,7,8,9]]
])("converts duration %s", async (input,fields) => {
  expect(await run(`const d=Temporal.Duration.from(${input});return [d.years,d.months,d.days,d.hours,d.minutes,d.seconds,d.milliseconds,d.microseconds,d.nanoseconds]`))
    .toMatchObject({ok:true,returnValue:fields});
});

it("copies branded fields without invoking shadowing getters or subclass constructors", async () => {
  expect(await run(`const Original=Temporal.Duration;class Child extends Original{};const d=new Child(1,2);
    Object.defineProperty(d,'years',{get(){throw 'shadow'}});d.label=7;
    Temporal.Duration=function(){throw 'replaced'};const copy=Original.from.call(null,d);
    return [copy!==d,copy.years,copy.months,Object.getPrototypeOf(copy)===Original.prototype,copy instanceof Child,Object.hasOwn(copy,'label')]`))
    .toMatchObject({ok:true,returnValue:[true,1,2,true,false,false]});
});

it("reads and converts property bags alphabetically", async () => {
  expect(await run(`const events=[];const d=Temporal.Duration.from(new Proxy({seconds:{valueOf(){events.push('number');return 2}}},
    {get(t,k){events.push(k);return Reflect.get(t,k)},ownKeys(){throw 'enumerated'}}));return [d.seconds,events]`))
    .toMatchObject({ok:true,returnValue:[2,["days","hours","microseconds","milliseconds","minutes","months","nanoseconds","seconds","number","weeks","years"]]});
});

it.each(["undefined","null","1","true","{}","{toString(){throw 'coerced'}}"])("rejects invalid Duration.from input %s", async input => {
  expect(await run(`try{Temporal.Duration.from(${input});return 'accepted'}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it.each(["{seconds:0.5}","{seconds:1,nanoseconds:-1}","{years:4294967296}","'not-duration'"])("rejects out-of-range or malformed duration %s", async input => {
  expect(await run(`try{Temporal.Duration.from(${input});return 'accepted'}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"RangeError"});
});

it("negates and takes absolute values using private fields and original prototypes", async () => {
  expect(await run(`const Original=Temporal.Duration;class Child extends Original{};const d=new Child(-1,-2,0,0,0,0,-3);
    Object.defineProperty(d,'seconds',{get(){throw 'shadow'}});d.label=7;
    const n=d.negated();const a=d.abs();const zero=new Original().negated();
    return [n.years,n.months,n.seconds,a.years,a.seconds,n!==d,a!==d,
      Object.getPrototypeOf(n)===Original.prototype,Object.getPrototypeOf(a)===Original.prototype,
      Object.hasOwn(n,'label'),zero.blank,Object.is(zero.seconds,-0)]`))
    .toMatchObject({ok:true,returnValue:[1,2,3,1,3,true,true,true,true,false,true,false]});
});

it("rejects unbranded method receivers and always rejects valueOf", async () => {
  expect(await run(`const names=[];for(const name of ['negated','abs','valueOf']){
    try{Temporal.Duration.prototype[name].call({})}catch(e){names.push(e.name)}}
    try{new Temporal.Duration().valueOf()}catch(e){names.push(e.name)}return names`))
    .toMatchObject({ok:true,returnValue:["TypeError","TypeError","TypeError","TypeError"]});
});

it("provides nonconstructible methods with standard metadata", async () => {
  expect(await run(`return ['from','negated','abs','valueOf'].map(name=>{
    const owner=name==='from'?Temporal.Duration:Temporal.Duration.prototype;const d=Object.getOwnPropertyDescriptor(owner,name);
    let error;try{new d.value()}catch(e){error=e.name}return [d.value.name,d.value.length,d.enumerable,d.writable,d.configurable,error]})`))
    .toMatchObject({ok:true,returnValue:[["from",1,false,true,true,"TypeError"],["negated",0,false,true,true,"TypeError"],
      ["abs",0,false,true,true,"TypeError"],["valueOf",0,false,true,true,"TypeError"]]});
});

it("retains exact maximum fields through copying and sign changes", async () => {
  expect(await run(`const d=new Temporal.Duration(0,0,0,0,0,0,9007199254740991,0,0,999999999);
    const copy=Temporal.Duration.from(d).negated().abs();return [copy.seconds,copy.nanoseconds,copy.sign]`))
    .toMatchObject({ok:true,returnValue:[9007199254740991,999999999,1]});
});

it("replays method results and references", async () => {
  const source="const from=Temporal.Duration.from;const d=from('-PT1.000000001S').abs().negated();await 0;return [d.seconds,d.nanoseconds,d.sign]";
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[-1,-1,-1]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

import { expect, it } from "vitest";
import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";

it.each(["-271821-04-19", "+275760-09-13"].flatMap(relativeTo =>
  ["year", "month", "week", "day", "hour", "nanosecond"].map(smallestUnit => ({relativeTo,smallestUnit}))))(
  "rounds blank durations at $relativeTo to $smallestUnit", async options => {
  expect(await run(`const original=new Temporal.Duration();
    const result=original.round(${JSON.stringify(options)});
    return [result.toString(),result!==original,result instanceof Temporal.Duration]`))
    .toMatchObject({ok:true,returnValue:["PT0S",true,true]});
});

it.each([
  ["ceil",2,-1], ["floor",1,-2], ["expand",2,-2], ["trunc",1,-1],
  ["halfCeil",2,-1], ["halfFloor",1,-2], ["halfExpand",2,-2],
  ["halfTrunc",1,-1], ["halfEven",2,-2]
])("rounds signed halfway durations with %s", async (roundingMode, positive, negative) => {
  expect(await run(`return [1,-1].map(sign=>Temporal.Duration.from({hours:sign,minutes:30*sign})
    .round({smallestUnit:'hours',roundingMode:${JSON.stringify(roundingMode)}}).hours)`))
    .toMatchObject({ok:true,returnValue:[positive,negative]});
});

it.each(["halfCeil", "halfExpand"])("preserves nanoseconds around a year midpoint with %s", async roundingMode => {
  expect(await run(`return [-1n,0n,1n].map(delta=>{
    const ns=365n*86400000000000n/2n+delta;
    return Temporal.Duration.from({seconds:Number(ns/1000000000n),nanoseconds:Number(ns%1000000000n)})
      .round({smallestUnit:'year',relativeTo:'2023-01-01',roundingMode:${JSON.stringify(roundingMode)}}).toString()
  })`)).toMatchObject({ok:true,returnValue:["PT0S","P1Y","P1Y"]});
});

it.each([
  ["{hours:1,minutes:30}", "'hour'", "PT2H"],
  ["{minutes:90}", "{largestUnit:'hours'}", "PT1H30M"],
  ["{hours:1,minutes:37}", "{smallestUnit:'minutes',roundingIncrement:15}", "PT1H30M"],
  ["{days:1,hours:12}", "'day'", "P2D"],
  ["{days:20}", "{smallestUnit:'months',relativeTo:'2023-01-01'}", "P1M"],
  ["{hours:12}", "{smallestUnit:'days',relativeTo:'2024-03-10T00:00[America/New_York]'}", "P1D"]
] as const)("rounds %s with %s", async (fields, options, expected) => {
  expect(await run(`const value=Temporal.Duration.from(${fields});const rounded=value.round(${options});
    return [rounded.toString(),rounded instanceof Temporal.Duration,rounded!==value]`))
    .toMatchObject({ok:true,returnValue:[expected,true,true]});
});

it.each(["undefined", "null", "1", "{}", "{smallestUnit:'auto'}", "{smallestUnit:'minutes',roundingIncrement:7}", "{largestUnit:'second',smallestUnit:'hour'}"])("rejects invalid options %s", async options => {
  const expected=["undefined","null","1"].includes(options)?"TypeError":"RangeError";
  expect(await run(`let name;try{new Temporal.Duration().round(${options})}catch(e){name=e.name}return name`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("reads options in order without enumeration", async () => {
  expect(await run(`const events=[];const options=new Proxy({smallestUnit:'hours'},{
    get(target,key){events.push(key);return target[key]},ownKeys(){throw 'enumerated'}
  });Temporal.Duration.from({hours:1}).round(options);return events`))
    .toMatchObject({ok:true,returnValue:["largestUnit","relativeTo","roundingIncrement","roundingMode","smallestUnit"]});
});

it("validates relativeTo before reading roundingIncrement", async () => {
  expect(await run(`const events=[];let name;try{new Temporal.Duration().round({relativeTo:'invalid',
    get roundingIncrement(){events.push('increment')}})}catch(e){name=e.name}return [name,events]`))
    .toMatchObject({ok:true,returnValue:["RangeError",[]]});
});

it("checks the private brand before option getters", async () => {
  expect(await run(`const events=[];let name;try{Temporal.Duration.prototype.round.call({},
    {get largestUnit(){events.push('largest')}})}catch(e){name=e.name}return [name,events]`))
    .toMatchObject({ok:true,returnValue:["TypeError",[]]});
});

it("returns an original-realm Duration despite public constructor changes", async () => {
  expect(await run(`const Original=Temporal.Duration;const value=Original.from({hours:1,minutes:30});
    Object.defineProperty(value,'hours',{get(){throw 'public getter'}});value.constructor=null;
    Temporal.Duration=function(){throw 'replacement'};const result=value.round('hour');
    return [Object.getPrototypeOf(result)===Original.prototype,result.hours]`))
    .toMatchObject({ok:true,returnValue:[true,2]});
});

it("has standard metadata and is not constructable", async () => {
  expect(await run(`const d=Object.getOwnPropertyDescriptor(Temporal.Duration.prototype,'round');
    let name;try{new d.value()}catch(e){name=e.name}return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable,name]`))
    .toMatchObject({ok:true,returnValue:["round",1,true,false,true,"TypeError"]});
});

it("replays a captured round method and owned result", async () => {
  let calls=0;const checkpoint=async()=>{calls++;};
  const source=`const value=Temporal.Duration.from({hours:1,minutes:30});const round=value.round;
    await checkpoint();const result=round.call(value,'hour');return [result.hours,result instanceof Temporal.Duration]`;
  const first=await run(source,{bindings:{checkpoint}});
  expect(first).toMatchObject({ok:true,returnValue:[2,true]});
  const snapshot=JSON.parse(serializeSafeJSSnapshot(first.snapshot));
  expect(await run(source,{bindings:{checkpoint},snapshot})).toMatchObject({ok:true,returnValue:[2,true]});
  expect(calls).toBe(1);
});

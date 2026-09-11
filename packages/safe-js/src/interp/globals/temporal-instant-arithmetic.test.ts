import { expect, it } from "vitest";
import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";

it("reads branded Duration slots without consulting shadowing properties", async () => {
  expect(await run(`const d=new Temporal.Duration(0,0,0,0,0,0,2);let reads=0;
    Object.defineProperty(d,'seconds',{get(){reads++;throw 'shadowed'}});
    Object.defineProperty(d,'days',{get(){reads++;throw 'shadowed'}});
    return [new Temporal.Instant(1n).add(d).epochNanoseconds,new Temporal.Instant(1n).subtract(d).epochNanoseconds,reads]`))
    .toMatchObject({ok:true,returnValue:[2000000001n,-1999999999n,0]});
});

it.each([
  ["{nanoseconds:1}",1n], ["'PT1.000000001S'",1000000001n],
  ["{hours:1,minutes:2,seconds:3,milliseconds:4,microseconds:5,nanoseconds:6}",3723004005006n],
  ["{nanoseconds:-1}",-1n], ["'-PT0.000000001S'",-1n], ["{seconds:'2'}",2000000000n]
])("adds and subtracts duration %s exactly", async (duration,delta) => {
  expect(await run(`const value=new Temporal.Instant(-1n);return [value.add(${duration}).epochNanoseconds,value.subtract(${duration}).epochNanoseconds]`))
    .toMatchObject({ok:true,returnValue:[-1n+delta,-1n-delta]});
});

it("reads duration fields alphabetically and coerces numbers without enumeration", async () => {
  expect(await run(`const events=[];const duration=new Proxy({seconds:{valueOf(){events.push('number');return 1}}},
    {get(t,k){events.push(k);return Reflect.get(t,k)},ownKeys(){throw 'enumerated'}});
    const value=new Temporal.Instant(0n).add(duration);return [value.epochNanoseconds,events]`))
    .toMatchObject({ok:true,returnValue:[1000000000n,["days","hours","microseconds","milliseconds","minutes","months","nanoseconds","seconds","number","weeks","years"]]});
});

it.each(["{days:1}","'P1D'","{years:1}","{months:1}","{weeks:1}","{seconds:0.5}","{seconds:Infinity}","{seconds:1,nanoseconds:-1}"])("rejects invalid Instant duration %s", async duration => {
  expect(await run(`try{new Temporal.Instant(0n).add(${duration});return 'accepted'}catch(error){return error.name}`))
    .toMatchObject({ok:true,returnValue:"RangeError"});
});

it("checks epoch overflow and permits exactly reaching either limit", async () => {
  expect(await run(`const max=new Temporal.Instant(8640000000000000000000n);const min=new Temporal.Instant(-8640000000000000000000n);
    const names=[];try{max.add({nanoseconds:1})}catch(error){names.push(error.name)}
    try{min.subtract({nanoseconds:1})}catch(error){names.push(error.name)}
    return [names,max.subtract({nanoseconds:1}).add({nanoseconds:1}).equals(max),min.add({nanoseconds:1}).subtract({nanoseconds:1}).equals(min)]`))
    .toMatchObject({ok:true,returnValue:[["RangeError","RangeError"],true,true]});
});

it("returns fresh original-realm Instants without copying subclass state", async () => {
  expect(await run(`const Original=Temporal.Instant;class Child extends Original{};const value=new Child(1n);value.label=7;
    Temporal.Instant=function(){throw 'replaced'};const copy=value.add({seconds:0});return [copy!==value,
    Object.getPrototypeOf(copy)===Original.prototype,copy instanceof Child,Object.hasOwn(copy,'label')]`))
    .toMatchObject({ok:true,returnValue:[true,true,false,false]});
});

it("rejects receivers before reading duration fields and stops on nonintegral fields", async () => {
  expect(await run(`let reads=0;const names=[];
    try{Temporal.Instant.prototype.add.call({},new Proxy({},{get(){reads++;throw 'read'}}))}catch(e){names.push(e.name)}
    try{new Temporal.Instant(0n).subtract({days:0.5,get hours(){reads++;throw 'later'}})}catch(e){names.push(e.name)}
    try{new Temporal.Instant(0n).add({toString(){reads++;return 'PT1S'}})}catch(e){names.push(e.name)}
    return [names,reads]`)).toMatchObject({ok:true,returnValue:[["TypeError","RangeError","TypeError"],0]});
});

it("performs exact arithmetic across the full epoch range", async () => {
  expect(await run(`return new Temporal.Instant(-8640000000000000000000n)
    .add({seconds:17280000000000}).epochNanoseconds`))
    .toMatchObject({ok:true,returnValue:8640000000000000000000n});
});

it("preserves arithmetic results in completed replay", async () => {
  const source="const value=new Temporal.Instant(-1n).add('PT1.000000001S').subtract({nanoseconds:1});await 0;return value.epochNanoseconds";
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:999999999n});
  expect(await run(source,{snapshot:JSON.parse(serializeSafeJSSnapshot(first.snapshot))}))
    .toMatchObject({ok:true,returnValue:999999999n});
});

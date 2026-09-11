import { expect, it } from "vitest";
import { run } from "../../run.js";
import { serializeSafeJSSnapshot } from "../../snapshot/dump-format.js";

it.each([
  ["ceil",0n], ["floor",-1000000000n], ["expand",0n], ["trunc",-1000000000n],
  ["halfCeil",0n], ["halfFloor",-1000000000n], ["halfExpand",0n],
  ["halfTrunc",-1000000000n], ["halfEven",0n]
])("rounds negative subsecond ties with %s", async (mode,expected) => {
  expect(await run(`return new Temporal.Instant(-500000000n).round({smallestUnit:'second',roundingMode:${JSON.stringify(mode)}}).epochNanoseconds`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("uses default half-expand and accepts whole-day increments", async () => {
  expect(await run(`const value=new Temporal.Instant(-1500000000n);return [value.round('seconds').epochNanoseconds,
    value.round({smallestUnit:'minute',roundingIncrement:1440}).epochNanoseconds,
    new Temporal.Instant(8640000000000000000000n).round('hour').epochNanoseconds]`))
    .toMatchObject({ok:true,returnValue:[-1000000000n,0n,8640000000000000000000n]});
});

it("reads and coerces options in order, once, without enumeration", async () => {
  expect(await run(`const events=[];const options=new Proxy({
    roundingIncrement:{valueOf(){events.push('number');return 2.9}},
    roundingMode:{toString(){events.push('mode');return 'floor'}},
    smallestUnit:{toString(){events.push('unit');return 'nanoseconds'}}
  },{get(t,k){events.push(k);return Reflect.get(t,k)},ownKeys(){throw 'enumerated'}});
    const value=new Temporal.Instant(5n).round(options);return [value.epochNanoseconds,events]`))
    .toMatchObject({ok:true,returnValue:[4n,["roundingIncrement","number","roundingMode","mode","smallestUnit","unit"]]});
});

it.each(["{}", "{smallestUnit:'day'}", "{smallestUnit:'auto'}", "{smallestUnit:'second',roundingIncrement:7}", "{smallestUnit:'hour',roundingIncrement:25}", "{smallestUnit:'nanosecond',roundingIncrement:1000000001}"])("rejects invalid rounding options %s", async options => {
  expect(await run(`try{new Temporal.Instant(1n).round(${options});return 'accepted'}catch(error){return error.name}`))
    .toMatchObject({ok:true,returnValue:"RangeError"});
});

it("creates an original-realm Instant rather than a subclass or species result", async () => {
  expect(await run(`const Original=Temporal.Instant;class Child extends Original {};
    const value=new Child(1n);value.constructor={get [Symbol.species](){throw 'species'}};
    Temporal.Instant=function(){};const copy=value.round('nanosecond');return [copy!==value,
    Object.getPrototypeOf(copy)===Original.prototype,copy instanceof Child,copy.epochNanoseconds]`))
    .toMatchObject({ok:true,returnValue:[true,true,false,1n]});
});

it("uses a null-prototype record for string shorthand", async () => {
  expect(await run(`Object.defineProperty(Object.prototype,'roundingIncrement',{get(){throw 'inherited'}});
    return new Temporal.Instant(1500000000n).round('second').epochNanoseconds`))
    .toMatchObject({ok:true,returnValue:2000000000n});
});

it("checks the receiver before touching options and stops after an invalid increment", async () => {
  expect(await run(`let reads=0;const options=new Proxy({},{get(){reads++;throw 'read'}});let receiver,increment;
    try{Temporal.Instant.prototype.round.call({},options)}catch(error){receiver=error.name}
    try{new Temporal.Instant(1n).round({roundingIncrement:0,get roundingMode(){reads++;throw 'mode'}})}catch(error){increment=error.name}
    return [receiver,increment,reads]`)).toMatchObject({ok:true,returnValue:["TypeError","RangeError",0]});
});

it("preserves rounded values across completed replay", async () => {
  const source="const value=new Temporal.Instant(-1500000000n).round({smallestUnit:'second',roundingMode:'halfEven'});await 0;return value.epochNanoseconds";
  const original=await run(source);
  expect(original).toMatchObject({ok:true,returnValue:-2000000000n});
  expect(await run(source,{snapshot:JSON.parse(serializeSafeJSSnapshot(original.snapshot))}))
    .toMatchObject({ok:true,returnValue:-2000000000n});
});

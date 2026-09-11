import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("returns owned Durations with exact signed differences", async () => {
  expect(await run(`const a=new Temporal.Instant(-1n),b=new Temporal.Instant(1000000001n);
    return [a.until(b).toJSON(),a.since(b).toJSON(),a.until(b) instanceof Temporal.Duration,
      a.until(b).nanoseconds,a.until(a).blank]`))
    .toMatchObject({ok:true,returnValue:["PT1.000000002S","-PT1.000000002S",true,2,true]});
});

it("balances the full Instant range without calendar units", async () => {
  expect(await run(`const a=new Temporal.Instant(-8640000000000000000000n),b=new Temporal.Instant(8640000000000000000000n);
    return [a.until(b).seconds,a.until(b,{largestUnit:'hours'}).hours,a.until(b).days]`))
    .toMatchObject({ok:true,returnValue:[17280000000000,4800000000,0]});
});

it.each([
  ["ceil",2,-1], ["floor",1,-2], ["expand",2,-2], ["trunc",1,-1],
  ["halfCeil",2,-1], ["halfFloor",1,-2], ["halfExpand",2,-2],
  ["halfTrunc",1,-1], ["halfEven",2,-2]
])("rounds signed differences using %s", async (mode,positive,negative) => {
  expect(await run(`const a=new Temporal.Instant(0n),b=new Temporal.Instant(1500000000n);
    const options={smallestUnit:'seconds',roundingMode:${JSON.stringify(mode)}};
    return [a.until(b,options).seconds,a.since(b,options).seconds,b.until(a,options).seconds,b.since(a,options).seconds]`))
    .toMatchObject({ok:true,returnValue:[positive,negative,negative,positive]});
});

it("converts other before ordered option reads without enumeration", async () => {
  expect(await run(`const events=[];const other={toString(){events.push('other');return '1970-01-01T00:00:01Z'}};
    const options=new Proxy({largestUnit:'seconds',roundingIncrement:{valueOf(){events.push('number');return 2.9}},roundingMode:'ceil',smallestUnit:'milliseconds'},
      {get(t,k){events.push(k);return Reflect.get(t,k)},ownKeys(){throw 'enumerated'}});
    return [new Temporal.Instant(0n).until(other,options).seconds,events]`))
    .toMatchObject({ok:true,returnValue:[1,["other","largestUnit","roundingIncrement","number","roundingMode","smallestUnit"]]});
});

it("validates receivers first and bypasses branded input coercion", async () => {
  expect(await run(`let reads=0;const other=new Temporal.Instant(1n);other.toString=()=>{reads++;throw 'coerced'};
    const options=new Proxy({},{get(){reads++;throw 'read'}});let name;
    try{Temporal.Instant.prototype.until.call({},other,options)}catch(e){name=e.name}
    return [name,new Temporal.Instant(0n).until(other).nanoseconds,reads]`))
    .toMatchObject({ok:true,returnValue:["TypeError",1,0]});
});

it.each(["{largestUnit:'day'}","{smallestUnit:'auto'}","{largestUnit:'nanosecond',smallestUnit:'second'}",
  "{smallestUnit:'hour',roundingIncrement:24}","{smallestUnit:'second',roundingIncrement:7}","{roundingIncrement:0}","{roundingMode:'bad'}"])
  ("rejects invalid difference options %s", async options => {
    expect(await run(`try{new Temporal.Instant(0n).until(new Temporal.Instant(0n),${options});return 'accepted'}catch(e){return e.name}`))
      .toMatchObject({ok:true,returnValue:"RangeError"});
  });

it.each(["null","'second'","1"])("rejects nonobject options %s", async options => {
  expect(await run(`try{new Temporal.Instant(0n).since(new Temporal.Instant(0n),${options});return 'accepted'}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it("defers unit-category validation but rejects unknown units immediately", async () => {
  expect(await run(`const logs=[];for(const unit of ['day','invalid']){const events=[];
    try{new Temporal.Instant(0n).until(new Temporal.Instant(0n),new Proxy({largestUnit:unit},{get(t,k){events.push(k);return Reflect.get(t,k)}}))}catch(e){events.push(e.name)}logs.push(events)}return logs`))
    .toMatchObject({ok:true,returnValue:[["largestUnit","roundingIncrement","roundingMode","smallestUnit","RangeError"],["largestUnit","RangeError"]]});
});

it("uses the original Duration prototype and standard method metadata", async () => {
  expect(await run(`const Original=Temporal.Duration;Temporal.Duration=function(){throw 'replaced'};
    const value=new Temporal.Instant(0n).until(new Temporal.Instant(1n));
    return [Object.getPrototypeOf(value)===Original.prototype,...['until','since'].map(name=>{
      const d=Object.getOwnPropertyDescriptor(Temporal.Instant.prototype,name);let error;
      try{new d.value()}catch(e){error=e.name}return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable,error]})]`))
    .toMatchObject({ok:true,returnValue:[true,["until",1,true,false,true,"TypeError"],["since",1,true,false,true,"TypeError"]]});
});

it("preserves difference results in completed replay", async () => {
  const source="const d=new Temporal.Instant(0n).until(new Temporal.Instant(1500000000n));await 0;return d.toJSON()";
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:"PT1.5S"});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:"PT1.5S"});
});

import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("rounds using elapsed progress through short and long local days", async () => {
  expect(await run(`return ['2021-03-14T12:15-04:00[America/New_York]','2021-11-07T11:45-05:00[America/New_York]']
    .map(text=>Temporal.ZonedDateTime.from(text).round('day').toString());`))
    .toMatchObject({ok:true,returnValue:["2021-03-14T00:00:00-05:00[America/New_York]","2021-11-08T00:00:00-05:00[America/New_York]"]});
});

it("rounds across offset transitions without losing overlap identity", async () => {
  expect(await run(`return ['2021-03-14T01:59:45-05:00[America/New_York]','2021-11-07T01:29:45-05:00[America/New_York]']
    .map(text=>Temporal.ZonedDateTime.from(text).round('minute').toString());`))
    .toMatchObject({ok:true,returnValue:["2021-03-14T03:00:00-04:00[America/New_York]","2021-11-07T01:30:00-05:00[America/New_York]"]});
});

it("validates options in order including increments for each unit", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'UTC');if(typeof a.round!=='function')throw 'missing';
    const events=[];a.round(new Proxy({smallestUnit:'minutes',roundingIncrement:15.9,roundingMode:'floor'},
      {get(t,k){events.push(k);return t[k]}}));const errors=[];
    for(const options of [undefined,{},'year',{smallestUnit:'day',roundingIncrement:2},{smallestUnit:'minute',roundingIncrement:7}])
      try{a.round(options)}catch(e){errors.push(e.name)}return [events,errors];`))
    .toMatchObject({ok:true,returnValue:[["roundingIncrement","roundingMode","smallestUnit"],["TypeError","RangeError","RangeError","RangeError","RangeError"]]});
});

it("brands first, preserves private calendar and creates fresh intrinsic values", async () => {
  expect(await run(`const method=Temporal.ZonedDateTime.prototype.round;if(typeof method!=='function')throw 'missing';let error;
    try{method.call({},new Proxy({},{get(){throw 'options'}}))}catch(e){error=e.name}
    class Derived extends Temporal.ZonedDateTime {}const a=new Derived(1n,'UTC','buddhist');
    for(const key of ['epochNanoseconds','timeZoneId','calendarId','constructor'])Object.defineProperty(a,key,{get(){throw 'shadow'}});
    const b=method.call(a,'nanosecond');return [error,b.epochNanoseconds,b.calendarId,b!==a,
      Object.getPrototypeOf(b)===Temporal.ZonedDateTime.prototype,method.length];`))
    .toMatchObject({ok:true,returnValue:["TypeError",1n,"buddhist",true,true,1]});
});

it("retains captured rounding through completed replay", async () => {
  const source=`const a=new Temporal.ZonedDateTime(123456789n,'UTC'),method=a.round;
    Temporal.ZonedDateTime=undefined;const b=method.call(a,'millisecond');await 0;return [method.name,b.toString()];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["round","1970-01-01T00:00:00.123+00:00[UTC]"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

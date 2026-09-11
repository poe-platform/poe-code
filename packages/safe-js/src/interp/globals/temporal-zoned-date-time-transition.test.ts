import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("finds transitions strictly before and after the receiver", async () => {
  expect(await run(`const a=Temporal.ZonedDateTime.from('2021-06-01T12:00-04:00[America/New_York]');
    const next=a.getTimeZoneTransition('next'),previous=a.getTimeZoneTransition({direction:'previous'});
    return [next.toString(),previous.toString(),next.getTimeZoneTransition('previous').equals(previous)];`))
    .toMatchObject({ok:true,returnValue:["2021-11-07T01:00:00-05:00[America/New_York]","2021-03-14T03:00:00-04:00[America/New_York]",true]});
});

it("validates direction even for fixed zones and reads it only once", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'+05:30');const log=[];
    const result=a.getTimeZoneTransition({get direction(){log.push('get');return {toString(){log.push('coerce');return 'next'}}}});
    const errors=[];for(const input of [undefined,null,{},'future'])try{a.getTimeZoneTransition(input)}catch(e){errors.push(e.name)}
    return [result,log,errors];`))
    .toMatchObject({ok:true,returnValue:[null,["get","coerce"],["TypeError","TypeError","RangeError","RangeError"]]});
});

it("brands before options and preserves private calendar and intrinsic prototype", async () => {
  expect(await run(`const method=Temporal.ZonedDateTime.prototype.getTimeZoneTransition;if(typeof method!=='function')throw 'missing';
    let error;try{method.call({},new Proxy({},{get(){throw 'options'}}))}catch(e){error=e.name}
    class Derived extends Temporal.ZonedDateTime {}const a=new Derived(1622548800000000000n,'America/New_York','buddhist');
    for(const key of ['epochNanoseconds','timeZoneId','calendarId','constructor'])Object.defineProperty(a,key,{get(){throw 'shadow'}});
    const b=method.call(a,'next');return [error,b.calendarId,Object.getPrototypeOf(b)===Temporal.ZonedDateTime.prototype,method.length];`))
    .toMatchObject({ok:true,returnValue:["TypeError","buddhist",true,1]});
});

it("preserves captured lookup methods and results through replay", async () => {
  const source=`const a=new Temporal.ZonedDateTime(1622548800000000000n,'America/New_York');const method=a.getTimeZoneTransition;
    Temporal.ZonedDateTime=undefined;const b=method.call(a,'next');await 0;return [method.name,b.toString()];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["getTimeZoneTransition","2021-11-07T01:00:00-05:00[America/New_York]"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

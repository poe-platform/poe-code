import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("finds local midnight without changing the zone or calendar", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(123456789n,'+05:30','buddhist');const b=a.startOfDay();
    return [b.toString(),b.epochNanoseconds,b!==a,a.epochNanoseconds,b.startOfDay()!==b];`))
    .toMatchObject({ok:true,returnValue:["1970-01-01T00:00:00+05:30[+05:30][u-ca=buddhist]",-19800000000000n,true,123456789n,true]});
});

it("returns the first valid instant when midnight is skipped", async () => {
  expect(await run(`const a=Temporal.ZonedDateTime.from('2015-10-18T12:00-02:00[America/Sao_Paulo]');
    const b=a.startOfDay();return [b.toString(),b.toInstant().toString(),b.hoursInDay];`))
    .toMatchObject({ok:true,returnValue:["2015-10-18T01:00:00-02:00[America/Sao_Paulo]","2015-10-18T03:00:00Z",23]});
});

it("uses private fields, intrinsic results and ignores arguments", async () => {
  expect(await run(`class Derived extends Temporal.ZonedDateTime {}const a=new Derived(0n,'UTC');
    for(const key of ['epochNanoseconds','timeZoneId','calendarId','constructor'])Object.defineProperty(a,key,{get(){throw 'shadow'}});
    const b=a.startOfDay(new Proxy({},{get(){throw 'argument'}}));let error;
    try{Temporal.ZonedDateTime.prototype.startOfDay.call({})}catch(e){error=e.name}
    return [b.epochNanoseconds,Object.getPrototypeOf(b)===Temporal.ZonedDateTime.prototype,error,a.startOfDay.length];`))
    .toMatchObject({ok:true,returnValue:[0n,true,"TypeError",0]});
});

it("replays captured start-of-day methods and results", async () => {
  const source=`const a=new Temporal.ZonedDateTime(0n,'+05:30');const method=a.startOfDay;
    Temporal.ZonedDateTime=undefined;const b=method.call(a);await 0;return [method.name,b.toString()];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["startOfDay","1970-01-01T00:00:00+05:30[+05:30]"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

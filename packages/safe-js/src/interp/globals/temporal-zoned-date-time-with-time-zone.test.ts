import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("changes the zone while preserving the instant and calendar", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'UTC','buddhist');
    const b=a.withTimeZone('+0530');return [b.epochNanoseconds,b.timeZoneId,b.calendarId,
      b.hour,b.minute,a.timeZoneId,Temporal.ZonedDateTime.compare(a,b),a!==b];`))
    .toMatchObject({ok:true,returnValue:[0n,"+05:30","buddhist",5,30,"UTC",0,true]});
});

it("accepts zoned strings and owned zone slots without public property reads", async () => {
  expect(await run(`class Derived extends Temporal.ZonedDateTime {}
    const a=new Derived(0n,'UTC'),zone=new Temporal.ZonedDateTime(1n,'+05:30');
    for(const value of [a,zone])for(const key of ['timeZoneId','epochNanoseconds','calendarId','constructor'])
      Object.defineProperty(value,key,{get(){throw 'shadow'}});
    const b=a.withTimeZone(zone),c=a.withTimeZone('2000-01-01T00:00[Asia/Tokyo]');
    return [b.timeZoneId,c.timeZoneId,Object.getPrototypeOf(b)===Temporal.ZonedDateTime.prototype];`))
    .toMatchObject({ok:true,returnValue:["+05:30","Asia/Tokyo",true]});
});

it("rejects forged receivers and non-string non-Temporal zones without coercion", async () => {
  expect(await run(`const method=Temporal.ZonedDateTime.prototype.withTimeZone;
    if(typeof method!=='function')throw 'missing';const reads=[],errors=[];
    const zone=new Proxy({},{get(){reads.push('get');throw 'coercion'}});
    for(const receiver of [{},new Temporal.ZonedDateTime(0n,'UTC')])
      try{method.call(receiver,zone)}catch(e){errors.push(e.name)}
    try{method.call(new Temporal.ZonedDateTime(0n,'UTC'),'+25:00')}catch(e){errors.push(e.name)}
    return [errors,reads];`)).toMatchObject({ok:true,returnValue:[["TypeError","TypeError","RangeError"],[]]});
});

it("preserves a captured method and result through completed replay", async () => {
  const source=`const a=new Temporal.ZonedDateTime(0n,'UTC');const method=a.withTimeZone;
    Temporal.ZonedDateTime=undefined;const b=method.call(a,'UTC');await 0;
    return [method.name,method.length,b!==a,b.epochNanoseconds,b.timeZoneId];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["withTimeZone",1,true,0n,"UTC"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

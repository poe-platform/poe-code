import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  ["Temporal.Duration.from({days:1}).total({relativeTo,unit:'hours'})",23],
  ["Temporal.Duration.compare({days:1},{hours:24},{relativeTo})",-1],
  ["Temporal.Duration.from({hours:23}).round({relativeTo,largestUnit:'day'}).toString()","P1D"]
])("uses a relative-date bag's private ZonedDateTime zone for %s", async (expression, expected) => {
  expect(await run(`class Zone extends Temporal.ZonedDateTime {}
    const zone=new Zone(0n,'America/New_York','buddhist');
    for(const key of ['timeZoneId','timeZone','calendarId','epochNanoseconds',Symbol.toPrimitive])
      Object.defineProperty(zone,key,{get(){throw Error('public field read')}});
    const relativeTo={year:2024,month:3,day:10,timeZone:zone};
    return ${expression}`)).toMatchObject({ok:true,returnValue:expected});
});

it("rejects lookalike and proxy zones before reading the following year field", async () => {
  expect(await run(`const zone=new Temporal.ZonedDateTime(0n,'UTC');const events=[];
    for(const timeZone of [Object.create(zone),new Proxy(zone,{
      get(){events.push('proxy');throw Error('proxy read')}
    })])try{Temporal.Duration.from({days:1}).total({unit:'hours',relativeTo:{
      month:3,day:10,timeZone,get year(){events.push('year');return 2024}
    }})}catch(error){events.push(error.name)}return events`))
    .toMatchObject({ok:true,returnValue:["TypeError","TypeError"]});
});

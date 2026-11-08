import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["Temporal.Duration.from({days:1}).total({relativeTo,unit:'hours'})",23],
  ["Temporal.Duration.compare({days:1},{hours:24},{relativeTo})",-1],
  ["Temporal.Duration.from({hours:23}).round({relativeTo,largestUnit:'day'}).toString()","P1D"]
])("uses private ZonedDateTime slots for %s", async (expression,expected) => {
  expect(await run(`const relativeTo=Temporal.ZonedDateTime.from('2021-03-13T12:00-05:00[America/New_York]');
    for(const key of ['calendar','calendarId','year','month','monthCode','day','hour','timeZone','timeZoneId','offset','epochNanoseconds'])
      Object.defineProperty(relativeTo,key,{get(){throw 'public read '+key}});
    return ${expression}`)).toMatchObject({ok:true,returnValue:expected});
});

it("preserves the calendar and exact overlap occurrence", async () => {
  expect(await run(`const a=Temporal.ZonedDateTime.from('2021-11-07T01:30-04:00[America/New_York][u-ca=buddhist]');
    const b=Temporal.ZonedDateTime.from('2021-11-07T01:30-05:00[America/New_York][u-ca=buddhist]');
    return [a,b].map(relativeTo=>Temporal.Duration.from({days:1}).total({relativeTo,unit:'hours'}));`))
    .toMatchObject({ok:true,returnValue:[25,24]});
});

it("retains owned relativeTo inputs through completed replay", async () => {
  const source=`const relativeTo=Temporal.ZonedDateTime.from('2021-03-13T12:00-05:00[America/New_York]');await 0;
    return Temporal.Duration.from({days:1}).total({relativeTo,unit:'hours'})`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:23});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:23});
});

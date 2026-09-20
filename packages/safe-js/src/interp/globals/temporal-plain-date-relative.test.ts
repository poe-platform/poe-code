import { expect, it } from "vitest";
import { run } from "../../run.js";

it("reads a calendar identifier from private PlainDate slots", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,1,1,'buddhist');
    for(const key of ['calendar','calendarId','toString'])Object.defineProperty(date,key,{get(){throw key}});
    return new Temporal.PlainDateTime(2000,1,1).withCalendar(date).toString()`))
    .toMatchObject({ok:true,returnValue:"2000-01-01T00:00:00[u-ca=buddhist]"});
});

it("uses private PlainDate relativeTo fields for calendar duration totals", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,1,'buddhist');
    for(const key of ['year','month','day','calendar','timeZone','hour'])Object.defineProperty(date,key,{get(){throw key}});
    return Temporal.Duration.from({months:1}).total({unit:'day',relativeTo:date})`))
    .toMatchObject({ok:true,returnValue:29});
});

it("uses private date relativeTo fields for duration comparison and rounding", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,1);Object.defineProperty(date,'year',{get(){throw 'public'}});
    return [Temporal.Duration.compare({months:1},{days:29},{relativeTo:date}),
      Temporal.Duration.from({days:29}).round({largestUnit:'month',relativeTo:date}).toString()]`))
    .toMatchObject({ok:true,returnValue:[0,"P1M"]});
});

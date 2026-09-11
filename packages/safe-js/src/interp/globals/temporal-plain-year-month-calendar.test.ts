import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "Temporal.PlainDate.from({calendar,year:2543,month:2,day:29})",
  "Temporal.PlainDateTime.from({calendar,year:2543,month:2,day:29})",
  "Temporal.PlainMonthDay.from({calendar,monthCode:'M02',day:29})",
  "Temporal.ZonedDateTime.from({calendar,year:2543,month:2,day:29,timeZone:'UTC'})",
  "new Temporal.PlainDate(2000,2,29).withCalendar(calendar)",
  "new Temporal.PlainDateTime(2000,2,29).withCalendar(calendar)",
  "new Temporal.ZonedDateTime(0n,'UTC').withCalendar(calendar)"
])("uses private year-month calendars in %s", async expression => {
  expect(await run(`const calendar=new Temporal.PlainYearMonth(2000,2,'buddhist',29);
    for(const key of ['calendarId','calendar','toString'])Object.defineProperty(calendar,key,{get(){throw Error('public read')}});
    return (${expression}).calendarId`)).toMatchObject({ok:true,returnValue:"buddhist"});
});

it("uses year-month calendars in relativeTo without reading public fields", async () => {
  expect(await run(`const calendar=new Temporal.PlainYearMonth(2000,2,'buddhist');
    Object.defineProperty(calendar,'calendarId',{get(){throw Error('public read')}});
    return Temporal.Duration.from({months:1}).total({unit:'days',relativeTo:{calendar,year:2543,month:1,day:31}})`))
    .toMatchObject({ok:true,returnValue:29});
});

it("rejects proxies and forged year-month calendar objects before date fields", async () => {
  expect(await run(`const reads=[];const value=new Temporal.PlainYearMonth(2000,2);
    for(const calendar of [new Proxy(value,{get(){reads.push('proxy');throw Error('trap')}}),Object.create(Temporal.PlainYearMonth.prototype)]){
      try{Temporal.PlainDate.from({calendar,get day(){reads.push('day');return 1},year:2000,month:1})}catch(e){reads.push(e.name)}
    }return reads`)).toMatchObject({ok:true,returnValue:["TypeError","TypeError"]});
});

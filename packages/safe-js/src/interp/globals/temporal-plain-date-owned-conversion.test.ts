import { expect, it } from "vitest";
import { run } from "../../run.js";

it("copies a ZonedDateTime's private local date and calendar before reading overflow", async () => {
  expect(await run(`const input=new Temporal.ZonedDateTime(0n,'-01:00','buddhist');
    const events=[];for(const key of ['year','month','day','calendar','calendarId','timeZoneId','epochNanoseconds'])
      Object.defineProperty(input,key,{get(){throw Error('public field read')}});
    const result=Temporal.PlainDate.from(input,{get overflow(){events.push('overflow');return 'reject'}});
    return [result.toString(),result instanceof Temporal.PlainDate,events]`))
    .toMatchObject({ok:true,returnValue:["1969-12-31[u-ca=buddhist]",true,["overflow"]]});
});

it.each(["new Temporal.PlainMonthDay(1,2)", "new Temporal.PlainYearMonth(2024,1)", "new Temporal.ZonedDateTime(0n,'UTC')"])(
  "rejects owned partial-date input %s without public reads", async input => {
    expect(await run(`const input=${input};let reads=0;
      for(const key of ['calendar','timeZone','year'])Object.defineProperty(input,key,{
        get(){reads++;throw Error('public field read')}
      });try{new Temporal.PlainDate(2024,1,1).with(input)}catch(error){return [error.name,reads]}`))
      .toMatchObject({ok:true,returnValue:["TypeError",0]});
  }
);

it("reads the timeZone property on a bare zoned argument but not its plainTime property", async () => {
  expect(await run(`const events=[];const zone=new Temporal.ZonedDateTime(0n,'+05:30');
    Object.defineProperty(zone,'timeZone',{get(){events.push('zone');return undefined}});
    Object.defineProperty(zone,'plainTime',{get(){throw Error('plainTime read')}});
    const result=new Temporal.PlainDate(2000,1,1).toZonedDateTime(zone);
    return [result.toString(),events]`))
    .toMatchObject({ok:true,returnValue:["2000-01-01T00:00:00+05:30[+05:30]",["zone"]]});
});

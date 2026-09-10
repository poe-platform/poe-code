import { expect, it } from "vitest";
import { run } from "../../run.js";

it("copies private ZonedDateTime local fields and calendar before reading overflow", async () => {
  expect(await run(`const input=new Temporal.ZonedDateTime(123456789n,'+05:30','buddhist');
    const events=[];for(const key of ['year','month','day','hour','minute','second','calendar','calendarId','timeZoneId','epochNanoseconds'])
      Object.defineProperty(input,key,{get(){throw Error('public field read')}});
    const result=Temporal.PlainDateTime.from(input,{get overflow(){events.push('overflow');return 'reject'}});
    return [result.toString(),result instanceof Temporal.PlainDateTime,events]`))
    .toMatchObject({ok:true,returnValue:["1970-01-01T05:30:00.123456789[u-ca=buddhist]",true,["overflow"]]});
});

it.each(["new Temporal.PlainMonthDay(1,2)", "new Temporal.PlainYearMonth(2024,1)", "new Temporal.ZonedDateTime(0n,'UTC')"])(
  "rejects owned partial-date-time input %s before public properties", async input => {
    expect(await run(`const input=${input};let reads=0;
      for(const key of ['calendar','timeZone','year','hour'])Object.defineProperty(input,key,{
        get(){reads++;throw Error('public property read')}
      });try{new Temporal.PlainDateTime(2024,1,1).with(input)}catch(error){return [error.name,reads]}`))
      .toMatchObject({ok:true,returnValue:["TypeError",0]});
  }
);

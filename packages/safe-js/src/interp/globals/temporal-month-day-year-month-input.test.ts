import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([false, true])("uses a YearMonth's private calendar (subclass: %s)", async (subclass) => {
  expect(await run(`class Derived extends Temporal.PlainYearMonth {}
    const input=new ${subclass ? "Derived" : "Temporal.PlainYearMonth"}(2000,2,'buddhist');
    Object.defineProperty(input,'day',{value:29});
    for(const key of ['calendar','calendarId'])Object.defineProperty(input,key,{get(){throw Error('shadow')}});
    const result=Temporal.PlainMonthDay.from(input);
    return [result.calendarId,result.monthCode,result.day,result.toString()];`))
    .toMatchObject({ok:true,returnValue:["buddhist","M02",29,"1972-02-29[u-ca=buddhist]"]});
});

it("still observes public date fields before overflow when using a private calendar", async () => {
  expect(await run(`const input=new Temporal.PlainYearMonth(2000,2,'buddhist'),log=[];
    Object.defineProperty(input,'calendar',{get(){throw Error('shadow')}});
    const fields={day:29,era:undefined,eraYear:undefined,month:2,monthCode:'M02',year:2543};
    for(const key of Object.keys(fields))Object.defineProperty(input,key,{get(){log.push(key);return fields[key]}});
    Temporal.PlainMonthDay.from(input,{get overflow(){log.push('overflow');return 'reject'}});
    return log;`)).toMatchObject({ok:true,returnValue:["day","era","eraYear","month","monthCode","year","overflow"]});
});

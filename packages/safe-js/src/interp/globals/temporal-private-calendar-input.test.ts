import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  ["PlainDate", "Temporal.PlainDate.from(input).calendarId", "buddhist"],
  ["PlainDateTime", "Temporal.PlainDateTime.from(input).calendarId", "buddhist"],
  ["ZonedDateTime", "Temporal.ZonedDateTime.from(input).calendarId", "buddhist"],
  ["Duration relativeTo", "new Temporal.Duration(0,0,0,1).total({unit:'hour',relativeTo:input})", 24]
])("preserves a YearMonth's private calendar in %s", async (_name, expression, expected) => {
  expect(await run(`const input=new Temporal.PlainYearMonth(2000,2,'buddhist');
    Object.defineProperties(input,{day:{value:29},timeZone:{value:'UTC'},
      calendar:{get(){throw Error('calendar read')}}});
    return ${expression};`)).toMatchObject({ok:true,returnValue:expected});
});

it.each(["PlainDate", "PlainDateTime", "ZonedDateTime"])("preserves a MonthDay's private calendar in %s", async (name) => {
  expect(await run(`const input=new Temporal.PlainMonthDay(2,29,'buddhist',2000);
    Object.defineProperties(input,{year:{value:2543},timeZone:{value:'UTC'},
      calendar:{get(){throw Error('calendar read')}}});
    return Temporal.${name}.from(input).calendarId;`))
    .toMatchObject({ok:true,returnValue:"buddhist"});
});

it("reads a proxy's calendar instead of treating its target's brand as its own", async () => {
  expect(await run(`const target=new Temporal.PlainYearMonth(2000,2,'buddhist'),log=[];
    const fields={calendar:'iso8601',year:2000,month:2,day:29};
    const input=new Proxy(target,{get(t,k){log.push(k);return fields[k]}});
    return [Temporal.PlainDate.from(input).toString(),log];`))
    .toMatchObject({ok:true,returnValue:["2000-02-29",["calendar","day","month","monthCode","year"]]});
});

it("does not bypass ordinary objects' throwing calendar getters", async () => {
  expect(await run(`const sentinel={};let caught;
    try{Temporal.PlainDate.from({get calendar(){throw sentinel},get day(){throw 'late'}})}catch(e){caught=e}
    return caught===sentinel;`)).toMatchObject({ok:true,returnValue:true});
});

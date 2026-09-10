import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("converts a leap month-day to a constrained date in the requested year", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(2,29);const d=t.toPlainDate({year:2001});
    return [d.toString(),d instanceof Temporal.PlainDate,t.toPlainDate({year:2000}).toString()]`))
    .toMatchObject({ok:true,returnValue:["2001-02-28",true,"2000-02-29"]});
});

it("reads only calendar year fields and ignores conflicting date/calendar fields", async () => {
  expect(await run(`const events=[];const input=new Proxy({year:2000,month:12,day:1,calendar:'invalid'},{get(t,k){events.push(k);return t[k]}});
    return [new Temporal.PlainMonthDay(2,29).toPlainDate(input).toString(),events]`))
    .toMatchObject({ok:true,returnValue:["2000-02-29",["year"]]});
});

it("accepts calendar era fields in their specified order", async () => {
  expect(await run(`const events=[];const input=new Proxy({era:'ce',eraYear:2000},{get(t,k){events.push(k);return t[k]}});
    return [new Temporal.PlainMonthDay(2,29,'gregory',2000).toPlainDate(input).toString(),events]`))
    .toMatchObject({ok:true,returnValue:["2000-02-29[u-ca=gregory]",["era","eraYear","year"]]});
});

it("converts PlainDate to a canonical month-day without reading public fields", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,29);
    for(const k of ['year','month','day','calendarId','monthCode'])Object.defineProperty(date,k,{get(){throw Error('shadow')}});
    const t=date.toPlainMonthDay();return [t instanceof Temporal.PlainMonthDay,t.toString({calendarName:'always'})]`))
    .toMatchObject({ok:true,returnValue:[true,"1972-02-29[u-ca=iso8601]"]});
});

it("converts using private month-day fields and calendar-aware year", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(2,29,'buddhist',2000);
    for(const k of ['year','month','day','calendarId','monthCode'])Object.defineProperty(t,k,{get(){throw Error('shadow')}});
    return t.toPlainDate({year:2543}).toString()`))
    .toMatchObject({ok:true,returnValue:"2000-02-29[u-ca=buddhist]"});
});

it.each(["undefined","null","2000","'2000'","{}"])("rejects missing/nonobject year input: %s", async input => {
  expect(await run(`try{new Temporal.PlainMonthDay(2,29).toPlainDate(${input})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it("preserves both conversion intrinsic identities through replay", async () => {
  const source=`const t=new Temporal.PlainDate(2000,2,29).toPlainMonthDay();await 0;return t.toPlainDate({year:2004}).toString()`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:"2004-02-29"});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:"2004-02-29"});
});

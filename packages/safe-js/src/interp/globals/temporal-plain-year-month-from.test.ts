import { expect, it } from "vitest";
import { run } from "../../run.js";

it("parses strings, canonicalizes reference days and constrains field bags", async () => {
  expect(await run(`return ['2000-02','2000-02-29',{year:2000,month:13}].map(x=>Temporal.PlainYearMonth.from(x).toString({calendarName:'always'}))`))
    .toMatchObject({ok:true,returnValue:["2000-02-01[u-ca=iso8601]","2000-02-01[u-ca=iso8601]","2000-12-01[u-ca=iso8601]"]});
});

it("copies private reference days into base instances while observing overflow", async () => {
  expect(await run(`class D extends Temporal.PlainYearMonth{};const t=new D(2000,2,'iso8601',29),events=[];
    for(const key of ['calendar','calendarId','year','month','monthCode','day'])Object.defineProperty(t,key,{get(){throw Error('shadow')}});
    const copy=Temporal.PlainYearMonth.from(t,{get overflow(){events.push('overflow');return 'reject'}});
    return [copy!==t,copy instanceof D,copy.toString({calendarName:'always'}),events]`))
    .toMatchObject({ok:true,returnValue:[true,false,"2000-02-29[u-ca=iso8601]",["overflow"]]});
});

it("reads year-month fields in order, never reads day, then reads overflow", async () => {
  expect(await run(`const events=[];const bag=new Proxy({year:2000,month:2},{get(t,k){events.push(k);return t[k]}});
    const result=Temporal.PlainYearMonth.from(bag,{get overflow(){events.push('overflow');return 'constrain'}});
    return [result.toString(),events]`)).toMatchObject({ok:true,returnValue:["2000-02",["calendar","month","monthCode","year","overflow"]]});
});

it("rejects bad month codes before options and range after options", async () => {
  expect(await run(`const events=[];for(const value of [{year:2000,monthCode:'bad'},{year:2000,month:13},'+999999-01','bad']){
    try{Temporal.PlainYearMonth.from(value,{get overflow(){events.push('overflow');return 'reject'}})}catch(e){events.push(e.name)}
    }return events`)).toMatchObject({ok:true,returnValue:["RangeError","overflow","RangeError","overflow","RangeError","RangeError"]});
});

it("uses private calendars of Temporal date inputs with public calendar shadows", async () => {
  expect(await run(`const value=new Temporal.PlainDate(2000,2,29,'buddhist');Object.defineProperty(value,'calendar',{get(){throw Error('shadow')}});
    const result=Temporal.PlainYearMonth.from(value);return [result.year,result.month,result.calendarId]`))
    .toMatchObject({ok:true,returnValue:[2543,2,"buddhist"]});
});

it("accepts private year-month calendar field values", async () => {
  expect(await run(`const calendar=new Temporal.PlainYearMonth(2000,2,'buddhist');
    return Temporal.PlainYearMonth.from({calendar,year:2543,month:2}).toString()`))
    .toMatchObject({ok:true,returnValue:"2000-02-01[u-ca=buddhist]"});
});

it("preserves representable boundary months when parsing", async () => {
  expect(await run(`return ['-271821-04','+275760-09'].map(x=>Temporal.PlainYearMonth.from(x).toString())`))
    .toMatchObject({ok:true,returnValue:["-271821-04","+275760-09"]});
});

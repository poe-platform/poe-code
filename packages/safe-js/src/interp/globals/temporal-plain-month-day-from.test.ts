import { expect, it } from "vitest";
import { run } from "../../run.js";

it("parses ISO strings and constrains field bags by default", async () => {
  expect(await run(`return ['02-29','--02-29','2000-02-29',{month:2,day:30}].map(x=>Temporal.PlainMonthDay.from(x).toString({calendarName:'always'}))`))
    .toMatchObject({ok:true,returnValue:Array(4).fill("1972-02-29[u-ca=iso8601]")});
});

it("copies owned slots without public reads and returns a base instance", async () => {
  expect(await run(`class D extends Temporal.PlainMonthDay{};const t=new D(2,29,'buddhist',2000);
    for(const key of ['calendar','day','month','monthCode','year'])Object.defineProperty(t,key,{get(){throw Error('shadow')}});
    const events=[];const copy=Temporal.PlainMonthDay.from(t,{get overflow(){events.push('overflow');return 'reject'}});
    return [copy!==t,copy instanceof D,copy.toString(),events]`))
    .toMatchObject({ok:true,returnValue:[true,false,"2000-02-29[u-ca=buddhist]",["overflow"]]});
});

it("reads calendar and fields in order before overflow", async () => {
  expect(await run(`const events=[];const bag=new Proxy({month:2,day:29},{get(t,k){events.push(k);return t[k]}});
    const value=Temporal.PlainMonthDay.from(bag,{get overflow(){events.push('overflow');return 'constrain'}});
    return [value.toString(),events]`))
    .toMatchObject({ok:true,returnValue:["02-29",["calendar","day","month","monthCode","year","overflow"]]});
});

it("rejects overflow and bad month codes with the required observation order", async () => {
  expect(await run(`const events=[];
    for(const bag of [{month:2,day:30},{monthCode:'bad',day:1}])try{
      Temporal.PlainMonthDay.from(bag,{get overflow(){events.push('overflow');return 'reject'}})
    }catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["overflow","RangeError","RangeError"]});
});

it("validates string syntax before options but checks non-ISO range afterwards", async () => {
  expect(await run(`const events=[];for(const source of ['bad','+999999-01-01[u-ca=buddhist]'])try{
    Temporal.PlainMonthDay.from(source,{get overflow(){events.push('overflow');return 'constrain'}})
    }catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["RangeError","overflow","RangeError"]});
});

it("compares the reference year as well as date and calendar", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(2,29,'iso8601',2000);
    return [t.equals(t),t.equals('02-29'),t.equals(new Temporal.PlainMonthDay(2,29,'buddhist',2000)),Temporal.PlainMonthDay.from('02-29').equals({month:2,day:29})]`))
    .toMatchObject({ok:true,returnValue:[true,false,false,true]});
});

it("accepts an owned month-day calendar without public calendar reads", async () => {
  expect(await run(`const calendar=new Temporal.PlainMonthDay(2,29,'buddhist',2000);
    Object.defineProperty(calendar,'calendarId',{get(){throw Error('shadow')}});
    const value=Temporal.PlainMonthDay.from({calendar,monthCode:'M02',day:29});
    return [value.calendarId,value.monthCode,value.day]`))
    .toMatchObject({ok:true,returnValue:["buddhist","M02",29]});
});

import { expect, it } from "vitest";
import { run } from "../../run.js";

it("merges year-month fields into a base instance without mutating the receiver", async () => {
  expect(await run(`class D extends Temporal.PlainYearMonth{};const t=new D(2000,1,'iso8601',31);
    const u=t.with({month:2});return [t.toString({calendarName:'always'}),u.toString({calendarName:'always'}),u instanceof D,u instanceof Temporal.PlainYearMonth]`))
    .toMatchObject({ok:true,returnValue:["2000-01-31[u-ca=iso8601]","2000-02-01[u-ca=iso8601]",false,true]});
});

it("checks exclusions and reads fields before overflow without reading day", async () => {
  expect(await run(`const events=[];const bag=new Proxy({month:3},{get(t,k){events.push(k);return t[k]}});
    const result=new Temporal.PlainYearMonth(2000,2).with(bag,{get overflow(){events.push('overflow');return 'constrain'}});
    return [result.toString(),events]`)).toMatchObject({ok:true,returnValue:["2000-03",["calendar","timeZone","month","monthCode","year","overflow"]]});
});

it("uses private non-ISO fields despite receiver shadows", async () => {
  expect(await run(`const t=new Temporal.PlainYearMonth(2000,2,'buddhist',29);
    for(const key of ['calendar','calendarId','year','month','monthCode'])Object.defineProperty(t,key,{get(){throw Error('shadow')}});
    const result=t.with({monthCode:'M03'});return [result.year,result.month,result.calendarId]`))
    .toMatchObject({ok:true,returnValue:[2543,3,"buddhist"]});
});

it("rejects empty partials and forbidden fields before reading options", async () => {
  expect(await run(`const t=new Temporal.PlainYearMonth(2000,2),events=[];
    for(const bag of [{},{day:1},{calendar:'iso8601'},{timeZone:'UTC'}])try{t.with(bag,{get overflow(){events.push('overflow');return 'constrain'}})}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:Array(4).fill("TypeError")});
});

it("rejects branded Temporal partials before public reads", async () => {
  expect(await run(`const t=new Temporal.PlainYearMonth(2000,2),events=[];
    for(const bag of [t,new Temporal.PlainDate(2000,1,2),new Temporal.PlainDateTime(2000,1,2),new Temporal.PlainTime(1),new Temporal.ZonedDateTime(0n,'UTC'),new Temporal.PlainMonthDay(1,2)]){
      Object.defineProperty(bag,'calendar',{get(){events.push('read');return undefined}});
      try{t.with(bag)}catch(e){events.push(e.name)}
    }return events`)).toMatchObject({ok:true,returnValue:Array(6).fill("TypeError")});
});

it("accepts ordinary fields on Instant and Duration objects", async () => {
  expect(await run(`const t=new Temporal.PlainYearMonth(2000,2),result=[];
    for(const bag of [new Temporal.Instant(0n),new Temporal.Duration()]){bag.month=3;result.push(t.with(bag).toString())}return result`))
    .toMatchObject({ok:true,returnValue:["2000-03","2000-03"]});
});

it("constrains invalid months by default and rejects them on request", async () => {
  expect(await run(`const t=new Temporal.PlainYearMonth(2000,2);let error;try{t.with({month:13},{overflow:'reject'})}catch(e){error=e.name}
    return [t.with({month:13}).toString(),error]`)).toMatchObject({ok:true,returnValue:["2000-12","RangeError"]});
});

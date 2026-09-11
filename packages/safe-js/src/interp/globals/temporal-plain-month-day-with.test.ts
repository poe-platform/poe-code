import { expect, it } from "vitest";
import { run } from "../../run.js";

it("merges fields without mutating the receiver and returns a base instance", async () => {
  expect(await run(`class D extends Temporal.PlainMonthDay{};const t=new D(1,31);
    const u=t.with({month:2});return [t.toString(),u.toString(),u instanceof D,u instanceof Temporal.PlainMonthDay]`))
    .toMatchObject({ok:true,returnValue:["01-31","02-29",false,true]});
});

it("reads partial-object exclusions and fields before overflow", async () => {
  expect(await run(`const events=[];const bag=new Proxy({day:3},{get(t,k){events.push(k);return t[k]}});
    const t=new Temporal.PlainMonthDay(1,2).with(bag,{get overflow(){events.push('overflow');return 'constrain'}});
    return [t.toString(),events]`))
    .toMatchObject({ok:true,returnValue:["01-03",["calendar","timeZone","day","month","monthCode","year","overflow"]]});
});

it("uses private calendar/date fields despite receiver shadows", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(1,2,'buddhist',2000);
    for(const k of ['calendar','calendarId','day','month','monthCode','year'])Object.defineProperty(t,k,{get(){throw Error('shadow')}});
    const u=t.with({day:3});return [u.calendarId,u.monthCode,u.day]`))
    .toMatchObject({ok:true,returnValue:["buddhist","M01",3]});
});

it("rejects empty partials and forbidden fields before reading options", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(1,2);const events=[];
    for(const bag of [{},{calendar:'iso8601'},{timeZone:'UTC'}])try{t.with(bag,{get overflow(){events.push('overflow');return 'constrain'}})}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:["TypeError","TypeError","TypeError"]});
});

it("rejects branded temporal partials before consulting their public properties", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(1,2);const events=[];
    for(const bag of [t,new Temporal.PlainDate(2000,1,2),new Temporal.PlainDateTime(2000,1,2),new Temporal.PlainTime(1),new Temporal.ZonedDateTime(0n,'UTC')]){
      Object.defineProperty(bag,'calendar',{get(){events.push('read');return undefined}});
      try{t.with(bag)}catch(e){events.push(e.name)}
    }return events`)).toMatchObject({ok:true,returnValue:Array(5).fill("TypeError")});
});

it("allows ordinary partial fields on Instant and Duration", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(1,2);const output=[];
    for(const bag of [new Temporal.Instant(0n),new Temporal.Duration()]){bag.day=3;output.push(t.with(bag).toString())}return output`))
    .toMatchObject({ok:true,returnValue:["01-03","01-03"]});
});

it("rejects overflowing merged dates when requested", async () => {
  expect(await run(`try{new Temporal.PlainMonthDay(1,31).with({month:2},{overflow:'reject'})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"RangeError"});
});

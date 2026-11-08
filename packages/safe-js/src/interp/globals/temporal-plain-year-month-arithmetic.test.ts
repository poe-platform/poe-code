import { expect, it } from "vitest";
import { run } from "../../run.js";

it("adds and subtracts calendar years/months and returns base instances", async () => {
  expect(await run(`class D extends Temporal.PlainYearMonth{};const t=new D(2000,2,'iso8601',29);
    const a=t.add({years:1,months:2}),b=t.subtract('P3M');
    return [a.toString(),b.toString(),t.toString({calendarName:'always'}),a instanceof D,a instanceof Temporal.PlainYearMonth]`))
    .toMatchObject({ok:true,returnValue:["2001-04","1999-11","2000-02-29[u-ca=iso8601]",false,true]});
});

it("uses private receiver and duration fields", async () => {
  expect(await run(`const t=new Temporal.PlainYearMonth(2000,2,'buddhist'),d=new Temporal.Duration(1,2);
    for(const key of ['year','month','calendarId'])Object.defineProperty(t,key,{get(){throw Error('shadow')}});
    Object.defineProperty(d,'months',{get(){throw Error('duration shadow')}});
    return [t.add(d).toString(),t.subtract(d).toString()]`))
    .toMatchObject({ok:true,returnValue:["2001-04-01[u-ca=buddhist]","1998-12-01[u-ca=buddhist]"]});
});

it("reads duration fields before overflow", async () => {
  expect(await run(`const events=[],d=new Proxy({months:1},{get(t,k){events.push(k);return t[k]}});
    const result=new Temporal.PlainYearMonth(2000,2).add(d,{get overflow(){events.push('overflow');return 'constrain'}});
    return [result.toString(),events]`)).toMatchObject({ok:true,returnValue:["2000-03",["days","hours","microseconds","milliseconds","minutes","months","nanoseconds","seconds","weeks","years","overflow"]]});
});

it.each(["weeks","days","hours","minutes","seconds","milliseconds","microseconds","nanoseconds"])("rejects nonzero %s after reading overflow", async unit => {
  expect(await run(`const events=[];for(const method of ['add','subtract'])try{new Temporal.PlainYearMonth(2000,2)[method]({${unit}:1},{get overflow(){events.push('overflow');return 'constrain'}})}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["overflow","RangeError","overflow","RangeError"]});
});

it("validates receivers before duration getters and invalid durations before options", async () => {
  expect(await run(`const events=[];try{Temporal.PlainYearMonth.prototype.add.call({}, {get months(){events.push('months');return 1}})}catch(e){events.push(e.name)}
    try{new Temporal.PlainYearMonth(2000,2).subtract({months:1,years:-1},{get overflow(){events.push('overflow');return 'constrain'}})}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:["TypeError","RangeError"]});
});

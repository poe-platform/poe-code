import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["2000-01-31T12:34:56", "{month:2}", "2000-02-29T12:34:56"],
  ["2000-01-31T12:34:56", "{monthCode:'M02'}", "2000-02-29T12:34:56"],
  ["2000-02-29T12:34:56", "{year:2001}", "2001-02-28T12:34:56"],
  ["2000-02-29T12:34:56[u-ca=buddhist]", "{year:2544}", "2001-02-28T12:34:56[u-ca=buddhist]"],
  ["2000-01-01T12:34:56", "{hour:3,millisecond:123,nanosecond:1}", "2000-01-01T03:34:56.123000001"]
])("merges calendar and time fields for %s with %s", async (input,fields,expected) => {
  expect(await run(`return Temporal.PlainDateTime.from(${JSON.stringify(input)}).with(${fields}).toString()`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("prepares fields before reading overflow without enumeration", async () => {
  expect(await run(`const events=[];const input=new Proxy({month:{valueOf(){events.push('number');return 2}}},{
    ownKeys(){throw 'enumerated'},get(t,k){events.push(k);return t[k]}});
    const result=new Temporal.PlainDateTime(2000,1,31).with(input,{get overflow(){events.push('overflow');return 'constrain'}});
    return [result.toString(),events]`)).toMatchObject({ok:true,returnValue:["2000-02-29T00:00:00",
      ["calendar","timeZone","day","hour","microsecond","millisecond","minute","month","number","monthCode","nanosecond","second","year","overflow"]]});
});

it("rejects an empty partial before reading options", async () => {
  expect(await run(`const events=[];const value=new Temporal.PlainDateTime(2000,1,1);if(typeof value.with!=='function')throw 'missing';
    try{value.with({}, {get overflow(){events.push('overflow')}})}
    catch(e){return [e.name,events]}`)).toMatchObject({ok:true,returnValue:["TypeError",[]]});
});

it.each(["{calendar:'iso8601'}","{timeZone:'UTC'}","new Temporal.PlainTime()","new Temporal.PlainDateTime(2000,1,1)"])("rejects forbidden partial input %s", async input => {
  expect(await run(`const value=new Temporal.PlainDateTime(2000,1,1);if(typeof value.with!=='function')throw 'missing';
    try{value.with(${input})}catch(e){return e.name}`)).toMatchObject({ok:true,returnValue:"TypeError"});
});

it.each(["{month:2}, {overflow:'reject'}", "{month:2,monthCode:'M03'}"])("rejects incompatible fields: %s", async args => {
  expect(await run(`try{new Temporal.PlainDateTime(2001,1,31).with(${args})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"RangeError"});
});

it("does not reject Duration when it carries a valid partial field", async () => {
  expect(await run(`const input=new Temporal.Duration();input.hour=3;
    return new Temporal.PlainDateTime(2000,1,1).with(input).hour`)).toMatchObject({ok:true,returnValue:3});
});

it("ignores receiver getters and subclass constructors, retaining the method through replay", async () => {
  const source=`class Derived extends Temporal.PlainDateTime{};const value=new Derived(2000,1,31);
    const proto=Temporal.PlainDateTime.prototype;const method=value.with;
    for(const key of ['year','month','calendarId','constructor'])Object.defineProperty(value,key,{get(){throw 'public read'}});
    Temporal.PlainDateTime=undefined;const result=method.call(value,{month:2});await 0;
    return [method.name,method.length,result!==value,Object.getPrototypeOf(result)===proto,result.toString()]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["with",1,true,true,"2000-02-29T00:00:00"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

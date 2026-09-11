import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";

it("constructs date and time fields with the PlainDateTime brand", async () => {
  expect(await run(`const t=new Temporal.PlainDateTime(2000,2,29,12,34,56,987,654,321);
    return [t.year,t.month,t.day,t.hour,t.minute,t.second,t.millisecond,t.microsecond,t.nanosecond,
      t.calendarId,t instanceof Temporal.PlainDateTime,Object.prototype.toString.call(t),
      Temporal.PlainDateTime.length,Object.getOwnPropertyDescriptor(Temporal.PlainDateTime,'prototype').writable]`))
    .toMatchObject({ok:true,returnValue:[2000,2,29,12,34,56,987,654,321,"iso8601",true,"[object Temporal.PlainDateTime]",3,false]});
});

it("uses ISO constructor fields even when the calendar changes exposed year", async () => {
  expect(await run(`const t=new Temporal.PlainDateTime(2000,2,29,12,0,0,0,0,0,'buddhist');
    return [t.year,t.month,t.day,t.calendarId,t.hour]`))
    .toMatchObject({ok:true,returnValue:[2543,2,29,"buddhist",12]});
});

it("converts PlainDateTime private time slots without reading overridden fields", async () => {
  expect(await run(`const t=new Temporal.PlainDateTime(2000,2,29,12,34,56,987,654,321);
    for(const name of ['hour','minute','second','millisecond','microsecond','nanosecond'])
      Object.defineProperty(t,name,{get(){throw new Error('public field read')}});
    const time=Temporal.PlainTime.from(t);
    return [time.hour,time.minute,time.second,time.millisecond,time.microsecond,time.nanosecond]`))
    .toMatchObject({ok:true,returnValue:[12,34,56,987,654,321]});
});

it("rejects invalid ISO dates after numeric argument conversion", async () => {
  expect(await run(`const events=[];const v=n=>({valueOf(){events.push(n);return n}});
    try{new Temporal.PlainDateTime(v(2001),v(2),v(29),v(12))}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:[2001,2,29,12,"RangeError"]});
});

it("preserves subclass identity and nanosecond fields through public replay", async () => {
  const source=`class Derived extends Temporal.PlainDateTime{};
    const t=new Derived(2000,2,29,12,34,56,987,654,321);
    await 0;return [t instanceof Derived,t.year,t.nanosecond,Temporal.PlainTime.from(t).microsecond]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[true,2000,321,654]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))}))
    .toMatchObject({ok:true,returnValue:first.returnValue});
});

it("imports host date-time bindings and replays host results without repeating calls", async () => {
  let calls=0;
  const load=()=>{calls++;return new Backend.PlainDateTime(2000,2,29,12,34,56,987,654,321,"buddhist");};
  const source="const result=await load();return [input.year,result.year,result.nanosecond,result instanceof Temporal.PlainDateTime]";
  const first=await run(source,{bindings:{load,input:new Backend.PlainDateTime(2020,1,2)}});
  expect(first).toMatchObject({ok:true,returnValue:[2020,2543,321,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first)),bindings:{load}}))
    .toMatchObject({ok:true,returnValue:first.returnValue});
  expect(calls).toBe(1);
});

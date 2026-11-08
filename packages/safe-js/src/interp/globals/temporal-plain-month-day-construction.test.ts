import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("constructs leap month-days with standard metadata and getters", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(2,29);
    return [t.monthCode,t.day,t.calendarId,t instanceof Temporal.PlainMonthDay,
      Object.prototype.toString.call(t),Temporal.PlainMonthDay.length,
      Object.getOwnPropertyDescriptor(Temporal.PlainMonthDay,'prototype').writable]`))
    .toMatchObject({ok:true,returnValue:["M02",29,"iso8601",true,"[object Temporal.PlainMonthDay]",2,false]});
});

it("coerces month and day before calendar validation, and year afterwards", async () => {
  expect(await run(`const events=[];const v=(s,n)=>({valueOf(){events.push(s);return n}});
    try{new Temporal.PlainMonthDay(v('month',2),v('day',29),'invalid',v('year',2000))}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:["month","day","RangeError"]});
});

it("truncates numeric arguments and validates the explicit reference year", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(2.9,29.8,'ISO8601',2000.9);
    let error;try{new Temporal.PlainMonthDay(2,29,'iso8601',2001)}catch(e){error=e.name}
    return [t.monthCode,t.day,t.calendarId,error]`))
    .toMatchObject({ok:true,returnValue:["M02",29,"iso8601","RangeError"]});
});

it("rejects invocation without new and nonstring calendars without coercion", async () => {
  expect(await run(`const events=[];try{Temporal.PlainMonthDay(2,29)}catch(e){events.push(e.name)}
    try{new Temporal.PlainMonthDay(2,29,{toString(){events.push('coerced');return 'iso8601'}})}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:["TypeError","TypeError"]});
});

it("brands getters and does not read shadowed calendar/date fields", async () => {
  expect(await run(`const t=new Temporal.PlainMonthDay(2,29,'buddhist',2000);const p=Temporal.PlainMonthDay.prototype;
    const day=Object.getOwnPropertyDescriptor(p,'day').get;
    for(const name of ['calendarId','monthCode','day'])Object.defineProperty(t,name,{get(){throw Error('shadow')}});
    const errors=[];for(const v of [{},p,new Proxy(t,{})])try{day.call(v)}catch(e){errors.push(e.name)}
    return [day.call(t),Object.getOwnPropertyDescriptor(p,'calendarId').get.call(t),errors]`))
    .toMatchObject({ok:true,returnValue:[29,"buddhist",["TypeError","TypeError","TypeError"]]});
});

it("preserves subclass identity and getters in public snapshot replay", async () => {
  const source=`class Derived extends Temporal.PlainMonthDay{};const t=new Derived(2,29);await 0;
    return [t instanceof Derived,t.monthCode,t.day]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[true,"M02",29]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))}))
    .toMatchObject({ok:true,returnValue:[true,"M02",29]});
});

it.each(["", "2", "NaN,1", "Infinity,1", "1,Infinity", "0,1", "13,1", "2,30", "1,1,'iso8601',Infinity"])("rejects invalid constructor arguments: %s", async args => {
  expect(await run(`try{new Temporal.PlainMonthDay(${args})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"RangeError"});
});

it("reads a custom newTarget prototype only after validating the ISO date", async () => {
  expect(await run(`const events=[];const target=new Proxy(function(){},{get(t,k,r){if(k==='prototype')events.push(k);return Reflect.get(t,k,r)}});
    try{Reflect.construct(Temporal.PlainMonthDay,[2,30],target)}catch(e){events.push(e.name)}
    const t=Reflect.construct(Temporal.PlainMonthDay,[2,29],target);
    return [events,Object.getPrototypeOf(t)===target.prototype]`))
    .toMatchObject({ok:true,returnValue:[["RangeError","prototype","prototype"],true]});
});
